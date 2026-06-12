import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { isOnline } from '../lib/presence';

export default function FriendsPanel({ onClose, onSelectUser }) {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (!user?.id) return;
    
    loadFriends();
    loadPendingRequests();
    loadAllUsers();

    // Supabase Realtime НЕ поддерживает OR в filter — нужны две отдельные подписки
    const handleFriendshipChange = (payload) => {
      console.log('🔄 Обновление дружбы через realtime:', payload);
      loadFriends();
      loadPendingRequests();
    };

    const asUserChannel = supabase
      .channel(`friendships-as-user-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `user_id=eq.${user.id}`
      }, handleFriendshipChange)
      .subscribe();

    const asFriendChannel = supabase
      .channel(`friendships-as-friend-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `friend_id=eq.${user.id}`
      }, handleFriendshipChange)
      .subscribe();

    return () => {
      console.log('🧹 FriendsPanel: Отписка от каналов');
      supabase.removeChannel(asUserChannel);
      supabase.removeChannel(asFriendChannel);
    };
  }, [user?.id]);

  // Живой поиск по серверу: ищем пользователей по нику через ilike с дебаунсом.
  // Не зависит от первичной выборки, поэтому ник собеседника находится надёжно.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !user?.id) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', user.id)
        .ilike('username', `%${q}%`)
        .limit(20);
      if (!cancelled && data) setSearchResults(data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, user?.id]);

  const loadFriends = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select('*, friend:profiles!friendships_friend_id_fkey(*)')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      if (error) {
        console.error('❌ Ошибка загрузки друзей:', error);
        return;
      }

      console.log('✅ Загружено друзей:', data?.length || 0);
      if (data) {
        setFriends(data.map(f => f.friend));
      }
    } catch (error) {
      console.error('❌ Ошибка в loadFriends:', error);
    }
  };

  const loadPendingRequests = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('friendships')
        .select('*, requester:profiles!friendships_user_id_fkey(*)')
        .eq('friend_id', user.id)
        .eq('status', 'pending');

      if (error) {
        console.error('❌ Ошибка загрузки запросов:', error);
        return;
      }

      console.log('✅ Загружено запросов:', data?.length || 0);
      if (data) {
        setPendingRequests(data);
      }
    } catch (error) {
      console.error('❌ Ошибка в loadPendingRequests:', error);
    }
  };

  const loadAllUsers = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', user.id)
        .order('username', { ascending: true });

      if (error) {
        console.error('❌ Ошибка загрузки пользователей:', error);
        return;
      }

      console.log('✅ Загружено пользователей:', data?.length || 0);
      if (data) setAllUsers(data);
    } catch (error) {
      console.error('❌ Ошибка в loadAllUsers:', error);
    }
  };

  const sendFriendRequest = async (friendId) => {
    // Check if friendship already exists
    const { data: existing } = await supabase
      .from('friendships')
      .select('*')
      .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

    if (existing && existing.length > 0) {
      const status = existing[0].status;
      if (status === 'accepted') {
        alert('Вы уже друзья');
      } else {
        alert('Запрос уже отправлен');
      }
      return;
    }

    const { error } = await supabase.from('friendships').insert({
      user_id: user.id,
      friend_id: friendId,
      status: 'pending'
    });

    if (error) {
      console.error('Friend request error:', error);
      alert('Ошибка: ' + error.message);
    } else {
      alert('Запрос отправлен!');
    }
  };

  const acceptRequest = async (requestId, requesterId) => {
    // Update the incoming request
    await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    // Проверяем, существует ли уже обратная запись, чтобы не плодить дубликаты
    const { data: existingReverse } = await supabase
      .from('friendships')
      .select('id')
      .eq('user_id', user.id)
      .eq('friend_id', requesterId)
      .maybeSingle();

    if (existingReverse) {
      await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', existingReverse.id);
    } else {
      await supabase.from('friendships').insert({
        user_id: user.id,
        friend_id: requesterId,
        status: 'accepted'
      });
    }

    loadFriends();
    loadPendingRequests();
  };

  const rejectRequest = async (requestId) => {
    await supabase
      .from('friendships')
      .delete()
      .eq('id', requestId);

    loadPendingRequests();
  };

  const removeFriend = async (friendId) => {
    await supabase
      .from('friendships')
      .delete()
      .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

    loadFriends();
  };

  // Не показываем всех подряд: список пуст, пока не введён поисковый запрос.
  // Также скрываем тех, кто уже в друзьях или прислал заявку.
  const friendIds = new Set(friends.map(f => f?.id).filter(Boolean));
  const pendingIds = new Set(pendingRequests.map(r => r?.requester?.id).filter(Boolean));
  const trimmedQuery = searchQuery.trim().toLowerCase();
  // Объединяем предзагруженный список и live-результаты поиска по серверу.
  const userPool = (() => {
    const map = new Map();
    for (const u of allUsers) map.set(u.id, u);
    for (const u of searchResults) map.set(u.id, u);
    return Array.from(map.values());
  })();
  const filteredUsers = trimmedQuery
    ? userPool.filter(u =>
        (u.username || '').toLowerCase().includes(trimmedQuery) &&
        !friendIds.has(u.id) &&
        !pendingIds.has(u.id)
      )
    : [];

  // Фон аватара из custom_color профиля (если задан), иначе остаётся градиент
  const avatarStyle = (u) => (u?.custom_color ? { background: u.custom_color } : undefined);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="glass-effect-dark rounded-3xl w-full max-w-3xl h-[700px] max-h-[90vh] flex flex-col shadow-2xl border border-dark-border/50 animate-scale-in">
        {/* Header */}
        <div className="p-6 border-b border-dark-border/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-xl shadow-glow">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Друзья</h2>
              <p className="text-sm text-gray-400">Управление контактами</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2.5 hover:bg-white/10 rounded-xl transition-all hover-lift text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-border/50 px-2 sm:px-6 gap-0.5 sm:gap-3">
          <button
            onClick={() => setActiveTab('friends')}
            className={`flex-1 min-w-0 overflow-hidden py-3 sm:py-4 text-xs sm:text-sm font-semibold transition-all relative ${
              activeTab === 'friends' 
                ? 'text-brand-primary' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span className="flex items-center justify-center gap-1 sm:gap-2 min-w-0 whitespace-nowrap">
              <svg className="w-4 h-4 hidden xl:inline-block flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Друзья
              <span className="px-2 py-0.5 bg-brand-primary/20 text-brand-primary rounded-full text-xs font-bold">{friends.length}</span>
            </span>
            {activeTab === 'friends' && (
              <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary"></div>
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex-1 min-w-0 overflow-hidden py-3 sm:py-4 text-xs sm:text-sm font-semibold transition-all relative ${
              activeTab === 'pending' 
                ? 'text-brand-primary' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span className="flex items-center justify-center gap-1 sm:gap-2 min-w-0 whitespace-nowrap">
              <svg className="w-4 h-4 hidden xl:inline-block flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Запросы
              {pendingRequests.length > 0 && (
                <span className="px-2 py-0.5 bg-brand-warning/20 text-brand-warning rounded-full text-xs font-bold animate-pulse">{pendingRequests.length}</span>
              )}
            </span>
            {activeTab === 'pending' && (
              <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary"></div>
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 min-w-0 overflow-hidden py-3 sm:py-4 text-xs sm:text-sm font-semibold transition-all relative ${
              activeTab === 'add' 
                ? 'text-brand-primary' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <span className="flex items-center justify-center gap-1 sm:gap-2 min-w-0 whitespace-nowrap">
              <svg className="w-4 h-4 hidden xl:inline-block flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Добавить
            </span>
            {activeTab === 'add' && (
              <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary"></div>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'friends' && (
            <div className="space-y-3">
              {friends.map(friend => (
                <div key={friend.id} className="card p-3 sm:p-4 flex items-center justify-between gap-3 hover-lift animate-fade-in-up">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold text-lg shadow-lg" style={avatarStyle(friend)}>
                        {friend.avatar_url
                          ? <img src={friend.avatar_url} alt={friend.username} className="w-full h-full object-cover" />
                          : friend.username[0].toUpperCase()}
                      </div>
                      {isOnline(friend) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-brand-success rounded-full border-2 border-dark-surface pulse-online"></div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white text-base sm:text-lg truncate">{friend.username}</div>
                      <div className="text-sm text-gray-400 truncate">{friend.bio || 'Нет статуса'}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        onSelectUser(friend);
                        onClose();
                      }}
                      title="Написать"
                      className="flex items-center gap-2 p-2.5 lg:px-4 lg:py-2.5 bg-gradient-to-r from-brand-primary to-brand-secondary hover:shadow-glow rounded-xl text-sm font-semibold whitespace-nowrap transition-all"
                    >
                      <svg className="w-5 h-5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span className="hidden lg:inline">Написать</span>
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Удалить из друзей?')) removeFriend(friend.id);
                      }}
                      title="Удалить"
                      className="flex items-center gap-2 p-2.5 lg:px-4 lg:py-2.5 bg-dark-elevated hover:bg-brand-danger/20 rounded-xl text-sm font-semibold whitespace-nowrap text-brand-danger border border-brand-danger/30 hover:border-brand-danger transition-all"
                    >
                      <svg className="w-5 h-5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span className="hidden lg:inline">Удалить</span>
                    </button>
                  </div>
                </div>
              ))}
              {friends.length === 0 && (
                <div className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-4 bg-dark-elevated rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-300 mb-2">У ва�� пока нет друзей</h3>
                  <p className="text-sm text-gray-500">Добав��те друзей, чтобы начать общение</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pending' && (
            <div className="space-y-3">
              {pendingRequests.map(req => (
                <div key={req.id} className="card p-3 sm:p-4 flex items-center justify-between gap-3 animate-fade-in-up border-l-4 border-brand-warning">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold text-lg shadow-lg" style={avatarStyle(req.requester)}>
                      {req.requester.avatar_url
                        ? <img src={req.requester.avatar_url} alt={req.requester.username} className="w-full h-full object-cover" />
                        : req.requester.username[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white text-base sm:text-lg truncate">{req.requester.username}</div>
                      <div className="text-sm text-gray-400 truncate">Хочет добавить вас в друзья</div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => acceptRequest(req.id, req.requester.id)}
                      className="px-5 py-2.5 bg-brand-success hover:shadow-lg rounded-xl text-sm font-semibold transition-all transform hover:scale-105"
                    >
                      Принять
                    </button>
                    <button
                      onClick={() => rejectRequest(req.id)}
                      className="px-4 py-2.5 bg-dark-elevated hover:bg-brand-danger/20 rounded-xl text-sm font-semibold text-brand-danger border border-brand-danger/30 hover:border-brand-danger transition-all"
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              ))}
              {pendingRequests.length === 0 && (
                <div className="text-center py-16">
                  <div className="w-20 h-20 mx-auto mb-4 bg-dark-elevated rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-300 mb-2">Нет входящих запросов</h3>
                  <p className="text-sm text-gray-500">Когда кто-то добавит вас, запрос появится здесь</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'add' && (
            <div>
              <div className="mb-6">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск пользователей..."
                    className="input-field !pl-12"
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-3">
                {!trimmedQuery && (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 mx-auto mb-4 bg-dark-elevated rounded-full flex items-center justify-center">
                      <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-300 mb-2">Найдите пользователя</h3>
                    <p className="text-sm text-gray-500">Начните вводить имя в поиск выше</p>
                  </div>
                )}
                {trimmedQuery && filteredUsers.length === 0 && (
                  <div className="text-center py-16">
                    <h3 className="text-lg font-semibold text-gray-300 mb-2">Никого не найдено</h3>
                    <p className="text-sm text-gray-500">Проверьте имя и попробуйте снова</p>
                  </div>
                )}
                {filteredUsers.map(u => (
                  <div key={u.id} className="card p-3 sm:p-4 flex items-center justify-between gap-3 hover-lift animate-fade-in-up">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative flex-shrink-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold text-lg shadow-lg" style={avatarStyle(u)}>
                          {u.avatar_url
                            ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" />
                            : u.username[0].toUpperCase()}
                        </div>
                        {isOnline(u) && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-brand-success rounded-full border-2 border-dark-surface pulse-online"></div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-white text-base sm:text-lg truncate">{u.username}</div>
                        <div className="text-sm text-gray-400 truncate">{u.bio || 'Нет статуса'}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => sendFriendRequest(u.id)}
                      className="flex-shrink-0 px-4 sm:px-5 py-2.5 bg-gradient-to-r from-brand-primary to-brand-secondary hover:shadow-glow rounded-xl text-sm font-semibold transition-all transform hover:scale-105 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Добавить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
