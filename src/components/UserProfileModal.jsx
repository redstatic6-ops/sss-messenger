import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { isOnline } from '../lib/presence';

export default function UserProfileModal({ userId, onClose, onOpenFullProfile }) {
  const { user: currentUser } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [isFriend, setIsFriend] = useState(false);
  const [friendshipStatus, setFriendshipStatus] = useState(null);

  useEffect(() => {
    loadProfile();
    checkFriendship();
  }, [userId]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (data) setProfile(data);
  };

  const checkFriendship = async () => {
    if (!currentUser?.id) return;
    const { data } = await supabase
      .from('friendships')
      .select('*')
      .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${userId}),and(user_id.eq.${userId},friend_id.eq.${currentUser.id})`)
      .eq('status', 'accepted');

    setIsFriend(data && data.length > 0);

    // Check pending
    const { data: pending } = await supabase
      .from('friendships')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('friend_id', userId)
      .eq('status', 'pending');

    if (pending && pending.length > 0) {
      setFriendshipStatus('pending');
    }
  };

  const sendFriendRequest = async () => {
    const { error } = await supabase.from('friendships').insert({
      user_id: currentUser.id,
      friend_id: userId,
      status: 'pending'
    });

    if (!error) {
      setFriendshipStatus('pending');
      alert('Запрос отправлен!');
    }
  };

  const removeFriend = async () => {
    await supabase
      .from('friendships')
      .delete()
      .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${userId}),and(user_id.eq.${userId},friend_id.eq.${currentUser.id})`);

    setIsFriend(false);
    alert('Удалено из друзей');
  };

  if (!profile) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-dark-surface rounded-lg w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Banner */}
        <div
          className="h-24 bg-gradient-to-r from-blue-500 to-purple-600"
          style={profile.banner_url ? { backgroundImage: `url(${profile.banner_url})`, backgroundSize: 'cover' } : {}}
        />

        {/* Avatar */}
        <div className="px-6 pb-6">
          <div className="relative -mt-12 mb-4">
            <div
              className="w-24 h-24 rounded-full border-4 border-dark-surface bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold"
              style={profile.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: 'cover' } : {}}
            >
              {!profile.avatar_url && profile.username[0]?.toUpperCase()}
            </div>
            {isOnline(profile) && (
              <div className="absolute bottom-1 right-1 w-6 h-6 bg-green-500 rounded-full border-4 border-dark-surface"></div>
            )}
          </div>

          {/* Username */}
          <h2 className="text-2xl font-bold mb-1" style={{ color: profile.custom_color }}>
            {profile.username}
          </h2>

          {/* Bio */}
          {profile.bio && (
            <p className="text-gray-400 text-sm mb-4">{profile.bio}</p>
          )}

          {/* Status */}
          <div className="text-sm text-gray-500 mb-4">
            {isOnline(profile) ? (
              <span className="text-green-400">● Онлайн</span>
            ) : (
              <span>Был(а) в сети {new Date(profile.last_seen).toLocaleString('ru')}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {currentUser.id !== userId && (
              <>
                {isFriend ? (
                  <button
                    onClick={removeFriend}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  >
                    Удалить из друзей
                  </button>
                ) : friendshipStatus === 'pending' ? (
                  <button
                    disabled
                    className="flex-1 px-4 py-2 bg-gray-600 rounded-lg cursor-not-allowed"
                  >
                    Запрос отправлен
                  </button>
                ) : (
                  <button
                    onClick={sendFriendRequest}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Добавить в друзья
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => onOpenFullProfile(profile)}
              className="px-4 py-2 bg-dark-hover hover:bg-dark-border rounded-lg transition-colors"
            >
              Полный профиль
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
