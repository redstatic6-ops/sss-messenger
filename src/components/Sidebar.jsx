import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import FriendsPanel from './FriendsPanel';
import { notify } from '../lib/native';
import { isOnline as isUserOnline } from '../lib/presence';
import { APP_CODENAME, APP_VERSION } from '../lib/updater';

export default function Sidebar({ selectedRoom, onSelectRoom, onOpenSettings, isMobile, refreshSignal }) {
  const { user, profile, signOut } = useAuthStore();
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  // Тик для пересчёта онлайн-статуса по свежести last_seen
  const [, setPresenceTick] = useState(0);

  // Принудительное обновление списка по сигналу извне (например, после удаления чата).
  useEffect(() => {
    if (!user?.id || !refreshSignal) return;
    loadRooms();
    loadUsers();
    loadPendingCount();
  }, [refreshSignal]);

  useEffect(() => {
    if (!user?.id) return;

    // Восстанавливаем данные при фокусе (фолбэк, если realtime отключён на сервере)
    const handleFocus = () => {
      console.log('🔄 Фокус: обновление данных');
      loadRooms();
      loadUsers();
      loadPendingCount();
    };

    window.addEventListener('focus', handleFocus);

    loadRooms();
    loadUsers();
    loadPendingCount();

    const roomMembersChannel = supabase
      .channel(`room-members-changes-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_members',
        filter: `user_id=eq.${user.id}`
      }, () => {
        loadRooms();
      })
      .subscribe();

    // Глобальная подписка на заявки в друзья — работает, даже когда панель «Друзья» закрыта.
    const friendRequestsChannel = supabase
      .channel(`friend-requests-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `friend_id=eq.${user.id}`
      }, (payload) => {
        loadPendingCount();
        loadUsers();
        if (payload?.eventType === 'INSERT' && payload?.new?.status === 'pending') {
          notify({
            title: 'Заявка в друзья',
            body: 'Вам отправили заявку в друзья',
            tag: 'friend-request',
          });
        }
      })
      .subscribe();

    // Живой онлайн-статус: ловим UPDATE профилей и обновляем точки «в сети»
    // в списке чатов и у друзей без перезагрузки приложения.
    const profilesChannel = supabase
      .channel(`sidebar-profiles-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        const p = payload.new;
        setRooms(prev => prev.map(r =>
          (!r.is_group && r.otherUser?.id === p.id) ? { ...r, otherUser: p } : r
        ));
        setUsers(prev => prev.map(u => (u?.id === p.id ? p : u)));
      })
      .subscribe();

    // Фолбэк-поллинг: чат, созданный другим пользователем, иногда не приходит
    // через realtime (RLS на room_members) — периодически обновляем список сами.
    const pollId = setInterval(() => {
      loadRooms();
      loadPendingCount();
    }, 15000);

    // Тик, чтобы протухший онлайн-статус (по last_seen) гас сам собой.
    const presenceTickId = setInterval(() => setPresenceTick(t => t + 1), 30000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      supabase.removeChannel(roomMembersChannel);
      supabase.removeChannel(friendRequestsChannel);
      supabase.removeChannel(profilesChannel);
      clearInterval(pollId);
      clearInterval(presenceTickId);
    };
  }, [user?.id]);

  const loadRooms = async () => {
    if (!user?.id) {
      console.log('❌ loadRooms: user.id отсутствует');
      return;
    }

    console.log('🔄 loadRooms: Загрузка комнат для user:', user.id);

    try {
      const { data: roomMembers, error } = await supabase
        .from('room_members')
        .select('room_id, rooms(*)')
        .eq('user_id', user.id);

      if (error) {
        console.error('❌ Ошибка загрузки room_members:', error);
        return;
      }

      console.log('📦 Загружено room_members:', roomMembers?.length || 0);

      if (roomMembers && roomMembers.length > 0) {
        const roomsData = await Promise.all(roomMembers.map(async (rm) => {
          const room = rm.rooms;

          // For direct chats, load the other user's info
          if (!room.is_group) {
            const { data: otherMembers } = await supabase
              .from('room_members')
              .select('user_id, profiles(*)')
              .eq('room_id', room.id)
              .neq('user_id', user.id)
              .limit(1)
              .maybeSingle();

            if (otherMembers) {
              room.otherUser = otherMembers.profiles;
            }
          }

          return room;
        }));

        console.log('✅ Комнаты загружены:', roomsData.length);

        // Схлопываем дубли личных чатов с одним и тем же собеседником.
        // Дубли возникают из-за гонки при создании чата с двух устройств одновременно.
        // Оставляем комнату с наименьшим id — её же открывает createDirectChat.
        const directByUser = new Map();
        const dedupedRooms = [];
        for (const room of roomsData) {
          if (!room.is_group && room.otherUser?.id) {
            const prev = directByUser.get(room.otherUser.id);
            if (prev) {
              if (String(room.id).localeCompare(String(prev.id)) < 0) {
                dedupedRooms[dedupedRooms.indexOf(prev)] = room;
                directByUser.set(room.otherUser.id, room);
              }
              continue;
            }
            directByUser.set(room.otherUser.id, room);
          }
          dedupedRooms.push(room);
        }

        setRooms(dedupedRooms);
      } else {
        console.log('📭 Комнаты не найдены');
        setRooms([]);
      }
    } catch (error) {
      console.error('❌ Ошибка в loadRooms:', error);
    }
  };

  const loadUsers = async () => {
    // Load only friends instead of all users
    const { data: friendships } = await supabase
      .from('friendships')
      .select('friend_id, friend:profiles!friendships_friend_id_fkey(*)')
      .eq('user_id', user.id)
      .eq('status', 'accepted');

    if (friendships) {
      setUsers(friendships.map(f => f.friend));
    }
  };

  const loadPendingCount = async () => {
    if (!user?.id) return;
    const { count } = await supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('friend_id', user.id)
      .eq('status', 'pending');
    setPendingCount(count || 0);
  };

  const createDirectChat = async (otherUserId) => {
    // Ищем ВСЕ личные комнаты с этим собеседником и открываем детерминированную
    // (с наименьшим id), чтобы ПК и телефон всегда заходили в один и тот же чат,
    // даже если дубли уже успели появиться.
    const { data: existingRooms } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id);

    const matchedRoomIds = [];
    if (existingRooms) {
      for (const rm of existingRooms) {
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', rm.room_id);

        if (members?.length === 2 && members.some(m => m.user_id === otherUserId)) {
          matchedRoomIds.push(rm.room_id);
        }
      }
    }

    if (matchedRoomIds.length > 0) {
      const chosenId = matchedRoomIds.sort((a, b) => String(a).localeCompare(String(b)))[0];
      const { data: room } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', chosenId)
        .single();

      if (room) {
        onSelectRoom(room);
        setShowNewChat(false);
        return;
      }
    }

    // Create new room
    const { data: newRoom, error: roomError } = await supabase
      .from('rooms')
      .insert({ is_group: false })
      .select()
      .single();

    if (roomError) {
      console.error('Error creating room:', roomError);
      alert('Ошибка создания чата: ' + roomError.message);
      return;
    }

    if (newRoom) {
      const { error: membersError } = await supabase.from('room_members').insert([
        { room_id: newRoom.id, user_id: user.id },
        { room_id: newRoom.id, user_id: otherUserId }
      ]);

      if (membersError) {
        console.error('Error adding members:', membersError);
        alert('Ошибка добавления участников: ' + membersError.message);
        return;
      }

      await loadRooms();
      onSelectRoom(newRoom);
      setShowNewChat(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) {
      alert('Введите название группы и выберите участников');
      return;
    }

    const { data: newRoom, error: roomError } = await supabase
      .from('rooms')
      .insert({ name: groupName, is_group: true })
      .select()
      .single();

    if (roomError) {
      console.error('Error creating group:', roomError);
      alert('Ошибка создания группы: ' + roomError.message);
      return;
    }

    if (newRoom) {
      const members = [
        { room_id: newRoom.id, user_id: user.id },
        ...selectedMembers.map(memberId => ({ room_id: newRoom.id, user_id: memberId }))
      ];

      const { error: membersError } = await supabase.from('room_members').insert(members);

      if (membersError) {
        console.error('Error adding members:', membersError);
        alert('Ошибка добавления участников: ' + membersError.message);
        return;
      }

      await loadRooms();
      onSelectRoom(newRoom);
      setShowCreateGroup(false);
      setGroupName('');
      setSelectedMembers([]);
    }
  };

  return (
    <div className={`${isMobile ? 'w-full' : 'w-80'} bg-dark-surface/50 backdrop-blur-xl border-r border-dark-border/50 flex flex-col relative z-10`}>
      {/* Header с профилем */}
      <div className="p-4 border-b border-dark-border/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold shadow-lg"
                style={profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: 'cover' } : {}}
              >
                {!profile?.avatar_url && (profile?.username?.[0]?.toUpperCase() || 'U')}
              </div>
              {isUserOnline(profile) && (
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-brand-success rounded-full border-2 border-dark-surface pulse-online"></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white truncate">{profile?.username}</div>
              <div className="text-xs text-gray-400">В сети</div>
            </div>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowFriends(true)}
            className="relative flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-dark-elevated hover:bg-dark-hover rounded-xl transition-all hover-lift border border-dark-border/50"
            title="Друзья"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span className="text-xs font-medium">Друзья</span>
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-brand-primary rounded-full shadow-glow">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-2.5 bg-dark-elevated hover:bg-dark-hover rounded-xl transition-all hover-lift border border-dark-border/50"
            title="Настройки"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={signOut}
            className="px-3 py-2.5 bg-dark-elevated hover:bg-brand-danger/20 rounded-xl transition-all hover-lift border border-dark-border/50 hover:border-brand-danger/50 text-brand-danger"
            title="Выйти"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Кодовое имя версии */}
        <div className="mt-3 text-center text-[10px] text-gray-500 tracking-wide select-none">
          {APP_CODENAME} {APP_VERSION}
        </div>
      </div>

      {/* Список комнат */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {/* Кнопки создания */}
          <div className="space-y-2 mb-4">
            <button
              onClick={() => setShowNewChat(!showNewChat)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-brand-primary to-brand-secondary hover:shadow-glow rounded-xl font-semibold transition-all transform hover:scale-105 active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Новый чат</span>
            </button>

            <button
              onClick={() => setShowCreateGroup(!showCreateGroup)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-dark-elevated hover:bg-dark-hover border border-brand-success/30 hover:border-brand-success rounded-xl font-medium transition-all"
            >
              <svg className="w-5 h-5 text-brand-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Создать группу</span>
            </button>
          </div>

          {/* Новый чат - выбор друга */}
          {showNewChat && (
            <div className="mb-4 p-4 glass-effect rounded-xl animate-slide-down">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Выберите друга</h3>
                <button 
                  onClick={() => setShowNewChat(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {users.map(u => (
                  <button
                    key={u.id}
                    onClick={() => createDirectChat(u.id)}
                    className="w-full p-3 hover:bg-dark-hover rounded-lg flex items-center gap-3 transition-all hover-lift"
                  >
                    <div className="relative">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white text-sm font-semibold shadow-md">
                        {u.username[0].toUpperCase()}
                      </div>
                      {isUserOnline(u) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-brand-success rounded-full border-2 border-dark-bg"></div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-sm font-medium text-white">{u.username}</div>
                      <div className="text-xs text-gray-400">{isUserOnline(u) ? 'В сети' : 'Не в сети'}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Создание группы */}
          {showCreateGroup && (
            <div className="mb-4 p-4 glass-effect rounded-xl animate-slide-down">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Создать группу</h3>
                <button 
                  onClick={() => setShowCreateGroup(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Название группы"
                className="input-field mb-3 text-sm"
              />
              <h4 className="text-xs font-semibold text-gray-400 mb-2">Участники</h4>
              <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                {users.map(u => (
                  <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-dark-hover rounded-lg cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedMembers([...selectedMembers, u.id]);
                        } else {
                          setSelectedMembers(selectedMembers.filter(id => id !== u.id));
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-600 text-brand-primary focus:ring-brand-primary"
                    />
                    <span className="text-sm text-white">{u.username}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={createGroup}
                className="btn-primary w-full text-sm"
              >
                Создать группу
              </button>
            </div>
          )}

          {/* Список чатов */}
          <div className="space-y-1">
            {rooms.map(room => {
              const displayName = room.is_group
                ? room.name
                : (room.otherUser?.username || 'Чат');
              const displayAvatar = room.is_group
                ? room.name?.[0]?.toUpperCase()
                : (room.otherUser?.username?.[0]?.toUpperCase() || 'C');
              const avatarUrl = !room.is_group ? room.otherUser?.avatar_url : null;
              const isOnline = !room.is_group && isUserOnline(room.otherUser);

              return (
                <button
                  key={room.id}
                  onClick={() => onSelectRoom(room)}
                  className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all hover-lift ${
                    selectedRoom?.id === room.id 
                      ? 'bg-gradient-to-r from-brand-primary/20 to-brand-secondary/20 border border-brand-primary/30 shadow-inner-glow' 
                      : 'hover:bg-dark-hover border border-transparent'
                  }`}
                >
                  <div className="relative">
                    <div
                      className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-semibold shadow-md"
                      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover' } : {}}
                    >
                      {!avatarUrl && displayAvatar}
                    </div>
                    {isOnline && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-brand-success rounded-full border-2 border-dark-surface"></div>
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-semibold text-white truncate">{displayName}</div>
                    <div className="text-xs text-gray-400 truncate">
                      {isOnline ? 'В сети' : 'Нажмите для открытия'}
                    </div>
                  </div>
                  {selectedRoom?.id === room.id && (
                    <div className="w-2 h-2 bg-brand-primary rounded-full animate-pulse"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showFriends && (
        <FriendsPanel
          onClose={() => { setShowFriends(false); loadPendingCount(); loadUsers(); }}
          onSelectUser={(friend) => createDirectChat(friend.id)}
        />
      )}
    </div>
  );
}
