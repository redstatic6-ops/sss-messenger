import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import UserProfileModal from './UserProfileModal';
import { isOnline } from '../lib/presence';
import {
  encryptText,
  decryptText,
  isEncryptedText,
  isEncryptedFile,
  encryptFile,
  decryptFileToUrl,
  diagnoseRoomKey,
} from '../lib/e2ee';
import { notify, appIsActive } from '../lib/native';

export default function ChatWindow({ room, isMobile, onBack, onRoomDeleted, onStartCall, callStatus = 'idle' }) {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [otherUser, setOtherUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [deletingMessage, setDeletingMessage] = useState(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [blockState, setBlockState] = useState('none'); // 'none' | 'blockedByMe' | 'blockedMe'
  const messagesEndRef = useRef(null);
  // Актуальный собеседник без устаревшего замыкания (для realtime-подписки на профили)
  const otherUserRef = useRef(null);
  // Кэш профилей отправителей: { [userId]: profile } — чтобы не дёргать БД на каждое сообщение
  const sendersCacheRef = useRef({});

  // Держим ref собеседника синхронным со state
  useEffect(() => {
    otherUserRef.current = otherUser;
    if (otherUser?.id) sendersCacheRef.current[otherUser.id] = otherUser;
  }, [otherUser]);



  useEffect(() => {
    if (!room?.id || !user?.id) {
      console.log('⏳ ChatWindow: Ожидание room.id или user.id...');
      return;
    }

    console.log('✅ ChatWindow: Загрузка данных для room:', room.id);
    
    // Очищаем предыдущие сообщения при смене комнаты
    setMessages([]);
    setOtherUser(null);
    setBlockState('none');
    setShowChatMenu(false);
    
    loadMessages();
    loadOtherUser();

    const channel = supabase
      .channel(`room:${room.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${room.id}`
      }, (payload) => {
        console.log('📨 Новое сообщение:', payload.new.id);
        loadMessageWithSender(payload.new.id);
        scrollToBottom();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${room.id}`
      }, async (payload) => {
        const hydrated = await hydrateMessage(payload.new);
        setMessages(prev => prev.map(m => m.id === hydrated.id ? { ...m, ...hydrated } : m));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${room.id}`
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();

    // Subscribe to profile changes
    const profileChannel = supabase
      .channel(`profile-changes-${room.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        const updated = payload.new;
        // Игнорируем апдейты профилей, не относящихся к этому чату
        const relevant =
          updated.id === otherUserRef.current?.id ||
          !!sendersCacheRef.current[updated.id] ||
          updated.id === user.id;
        if (!relevant) return;

        // Обновляем кэш отправителей
        if (sendersCacheRef.current[updated.id]) {
          sendersCacheRef.current[updated.id] = updated;
        }
        if (otherUserRef.current && updated.id === otherUserRef.current.id) {
          setOtherUser(updated);
        }
        // Обновляем инфо об отправителе в сообщениях
        setMessages(prev => prev.map(m =>
          m.sender_id === updated.id ? { ...m, sender: updated } : m
        ));
      })
      .subscribe();

    return () => {
      console.log('🧹 ChatWindow: Очистка подписок для room:', room.id);
      supabase.removeChannel(channel);
      supabase.removeChannel(profileChannel);
    };
  }, [room?.id, user?.id]);

  // Расшифровываем сообщение (текст и/или вложение) перед отображением.
  // Незашифрованные (старые) сообщения возвращаются как есть.
  const hydrateMessage = async (rawMsg) => {
    if (!rawMsg) return rawMsg;
    const out = { ...rawMsg };
    try {
      if (isEncryptedText(rawMsg.content)) {
        out.content = await decryptText(room, rawMsg.content);
      } else if (isEncryptedFile(rawMsg.content)) {
        out.content = '';
        const srcUrl = rawMsg.file_url || rawMsg.image_url;
        if (srcUrl) {
          const dec = await decryptFileToUrl(room, srcUrl, rawMsg.content);
          if (dec && !dec.legacy) {
            if ((dec.type || '').startsWith('image/')) {
              out.image_url = dec.url;
              out.file_url = null;
            } else {
              out.file_url = dec.url;
              out.file_name = dec.name || rawMsg.file_name;
              out.image_url = null;
            }
          }
        }
      }
    } catch (err) {
      console.warn('hydrateMessage error', err);
    }
    return out;
  };

  // Профиль отправителя из кэша или из БД (с занесением в кэш)
  const getSender = async (senderId) => {
    if (!senderId) return null;
    const cache = sendersCacheRef.current;
    if (cache[senderId]) return cache[senderId];
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', senderId)
      .single();
    if (data) cache[senderId] = data;
    return data;
  };

  const loadOtherUser = async () => {
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id, profiles(*)')
      .eq('room_id', room.id)
      .neq('user_id', user.id);

    if (members && members.length > 0) {
      const otherProfile = members[0].profiles;
      setOtherUser(otherProfile);
      loadBlockState(otherProfile?.id);
    }
  };

  const loadMessageWithSender = async (messageId) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (data) {
      // Отправителя берём из кэша (без лишнего join на каждое сообщение)
      data.sender = await getSender(data.sender_id);
      const hydrated = await hydrateMessage(data);
      // Защита от дублей: realtime INSERT может прийти после первичной загрузки.
      let isNew = false;
      setMessages(prev => {
        if (prev.some(m => m.id === hydrated.id)) return prev;
        isNew = true;
        return [...prev, hydrated];
      });

      // Уведомление о новом входящем сообщении, когда приложение свёрнуто/неактивно.
      if (isNew && hydrated.sender_id !== user?.id && !appIsActive()) {
        const preview = hydrated.content
          ? hydrated.content
          : hydrated.image_url
            ? '📷 Изображение'
            : hydrated.file_url
              ? '📎 Файл'
              : 'Новое сообщение';
        notify({
          title: hydrated.sender?.username || 'Новое сообщение',
          body: preview,
          tag: `room-${room.id}`,
        });
      }
    }
  };

  const loadMessages = async () => {
    if (!room?.id) {
      console.log('❌ loadMessages: room.id отсутствует');
      return;
    }

    console.log('🔄 loadMessages: Загрузка сообщений для room:', room.id);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*, sender:profiles(*)')
        .eq('room_id', room.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Ошибка загрузки сообщений:', error);
        return;
      }

      console.log('✅ Загружено сообщений:', data?.length || 0);

      if (data) {
        // Наполняем кэш отправителей из загруженных сообщений
        data.forEach((m) => {
          if (m.sender && m.sender_id) sendersCacheRef.current[m.sender_id] = m.sender;
        });
        const hydrated = await Promise.all(data.map(hydrateMessage));
        setMessages(hydrated);
        scrollToBottom();
        markAsRead(hydrated);
      }
    } catch (error) {
      console.error('❌ Ошибка в loadMessages:', error);
    }
  };

  const markAsRead = async (msgs) => {
    const unreadMessages = msgs.filter(m =>
      m.sender_id !== user.id && !m.read_by?.includes(user.id)
    );

    if (unreadMessages.length === 0) return;

    // Параллельно вместо последовательных запросов (был N+1)
    await Promise.all(
      unreadMessages.map((msg) =>
        supabase
          .from('messages')
          .update({ read_by: [...(msg.read_by || []), user.id] })
          .eq('id', msg.id)
      )
    );
  };

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text) return;

    const MAX_MESSAGE_LENGTH = 4000;
    if (text.length > MAX_MESSAGE_LENGTH) {
      alert('Сообщение слишком длинное: ' + text.length + ' символов. Максимум — ' + MAX_MESSAGE_LENGTH + '.');
      return;
    }

    if (blockState === 'blockedByMe') {
      alert('Вы заблокировали этого пользователя. Снимите блокировку, чтобы писать.');
      return;
    }
    if (blockState === 'blockedMe') {
      alert('Этот пользователь ограничил переписку с вами.');
      return;
    }

    // E2EE: шифруем перед отправкой. В БД уходит только шифртекст.
    const encrypted = await encryptText(room, text);
    if (!encrypted) {
      const reason = await diagnoseRoomKey(room);
      alert(reason || 'Не удалось зашифровать сообщение: нет ключа шифрования для этого чата.');
      return;
    }

    await supabase.from('messages').insert({
      room_id: room.id,
      sender_id: user.id,
      content: encrypted,
      reply_to_id: replyTo?.id || null,
      read_by: [user.id]
    });

    setNewMessage('');
    setReplyTo(null);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // E2EE: шифруем файл клиентом и заливаем только шифртекст.
      const encrypted = await encryptFile(room, file);
      if (!encrypted) {
        const reason = await diagnoseRoomKey(room);
        alert(reason || 'Не удалось зашифровать файл: нет ключа шифрования для этого чата.');
        return;
      }
      const { blob, envelope } = encrypted;
      const fileName = `${user.id}/${Date.now()}.enc`;
      const bucket = 'message-files';

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, blob, { contentType: 'application/octet-stream' });

      if (uploadError) {
        alert('Ошибка загрузки: ' + uploadError.message);
        return;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

      await supabase.from('messages').insert({
        room_id: room.id,
        sender_id: user.id,
        content: envelope,
        file_url: data.publicUrl,
        file_name: file.name,
        file_type: file.type,
        read_by: [user.id]
      });
    } catch (err) {
      alert('Ошибка отправки файла: ' + (err?.message || err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const MENU_WIDTH = 200;
  const MENU_HEIGHT = 170;
  const handleContextMenu = (e, message) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - MENU_WIDTH);
    const y = Math.min(e.clientY, window.innerHeight - MENU_HEIGHT);
    setContextMenu({ x: Math.max(8, x), y: Math.max(8, y), message });
  };

  const openEditModal = (message) => {
    setEditingMessage(message);
    setEditContent(message.content || '');
    setContextMenu(null);
  };

  const submitEdit = async () => {
    if (editingMessage && editContent.trim()) {
      await editMessage(editingMessage, editContent.trim());
    }
    setEditingMessage(null);
    setEditContent('');
  };

  const confirmDelete = async () => {
    if (deletingMessage) {
      await deleteMessage(deletingMessage);
    }
    setDeletingMessage(null);
  };

  const editMessage = async (message, newContent) => {
    const encrypted = await encryptText(room, newContent);
    if (!encrypted) {
      alert('Не удалось зашифровать сообщение: нет ключа шифрования.');
      return;
    }
    await supabase
      .from('messages')
      .update({ content: encrypted, is_edited: true })
      .eq('id', message.id);
    setContextMenu(null);
  };

  const deleteMessage = async (message) => {
    await supabase
      .from('messages')
      .delete()
      .eq('id', message.id);
    setContextMenu(null);
  };

  const getMessageStatus = (message) => {
    if (message.sender_id !== user.id) return null;

    const readCount = message.read_by?.length || 0;
    if (readCount > 1) return '✓✓'; // Read by others
    return '✓'; // Sent
  };

  const loadBlockState = async (otherId) => {
    if (!otherId || !user?.id) return;
    const { data } = await supabase
      .from('blocked_users')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${user.id})`);
    if (data && data.length > 0) {
      setBlockState(data.some(b => b.blocker_id === user.id) ? 'blockedByMe' : 'blockedMe');
    } else {
      setBlockState('none');
    }
  };

  const blockUser = async () => {
    if (!otherUser) return;
    const { error } = await supabase
      .from('blocked_users')
      .insert({ blocker_id: user.id, blocked_id: otherUser.id });
    if (error) { alert('Не удалось заблокировать: ' + error.message); return; }
    setBlockState('blockedByMe');
    setShowChatMenu(false);
  };

  const unblockUser = async () => {
    if (!otherUser) return;
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', otherUser.id);
    if (error) { alert('Не удалось разблокировать: ' + error.message); return; }
    setBlockState('none');
    setShowChatMenu(false);
  };

  const deleteChatForSelf = async () => {
    setShowChatMenu(false);
    if (!confirm('Удалить чат только у себя? У собеседника он останется.')) return;
    const { data: removed, error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', room.id)
      .eq('user_id', user.id)
      .select('room_id');
    if (error) { alert('Не удалось удалить чат: ' + error.message); return; }
    if (!removed || removed.length === 0) {
      alert('Чат не удалён: нет прав на удаление (RLS). Примените SQL-политику room_members_delete_member из инструкции.');
      return;
    }
    onRoomDeleted && onRoomDeleted();
  };

  const deleteChatForBoth = async () => {
    setShowChatMenu(false);
    if (!confirm('Удалить чат у обоих? Все сообщения будут удалены безвозвратно.')) return;
    await supabase.from('messages').delete().eq('room_id', room.id);
    await supabase.from('room_members').delete().eq('room_id', room.id);
    const { data: removedRoom, error } = await supabase.from('rooms').delete().eq('id', room.id).select('id');
    if (error) {
      alert('Не удалось полностью удалить чат: ' + error.message + '. Возможно, нужно применить SQL-политики (см. инструкцию в чате).');
      return;
    }
    if (!removedRoom || removedRoom.length === 0) {
      alert('Чат не удалён из базы: нет прав (RLS). Примените SQL-политики rooms/room_members/messages delete из инструкции.');
      return;
    }
    onRoomDeleted && onRoomDeleted();
  };

  return (
    <div className="flex-1 flex flex-col bg-dark-surface/30 backdrop-blur-sm">
      {/* Header */}
      <div className="h-18 border-b border-dark-border/50 backdrop-blur-xl bg-dark-surface/50">
        <div className="h-full flex items-center px-6 gap-4">
          {/* Кнопка "Назад" для мобильных */}
          {isMobile && onBack && (
            <button
              onClick={onBack}
              className="p-2 hover:bg-dark-hover rounded-xl transition-all"
              title="Назад"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          {otherUser && (
            <>
              <div className="relative group">
                <div
                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold cursor-pointer hover:shadow-glow transition-all transform hover:scale-105 shadow-lg overflow-hidden"
                  style={otherUser.avatar_url ? { backgroundImage: `url(${otherUser.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                  onClick={() => setSelectedUserId(otherUser.id)}
                >
                  {!otherUser.avatar_url && otherUser.username?.[0]?.toUpperCase()}
                </div>
                {isOnline(otherUser) && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-brand-success rounded-full border-2 border-dark-surface pulse-online"></div>
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-white truncate" style={{ color: otherUser.custom_color }}>
                  {otherUser.username}
                </h2>
                <div className="flex items-center gap-2">
                  {isOnline(otherUser) ? (
                    <span className="text-xs text-brand-success font-medium flex items-center gap-1">
                      <span className="w-2 h-2 bg-brand-success rounded-full animate-pulse"></span>
                      В сети
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">Не в сети</span>
                  )}
                </div>
              </div>
              
              {/* Кнопки звонков */}
              <div className="flex gap-2">
                <button
                  onClick={() => onStartCall && onStartCall(room.id, 'audio', otherUser)}
                  disabled={callStatus !== 'idle'}
                  className="p-2.5 bg-dark-elevated hover:bg-brand-success/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed group border border-dark-border/50 hover:border-brand-success/50 hover-lift"
                  title="Аудиозвонок"
                >
                  <svg className="w-5 h-5 text-brand-success transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
                <button
                  onClick={() => onStartCall && onStartCall(room.id, 'video', otherUser)}
                  disabled={callStatus !== 'idle'}
                  className="p-2.5 bg-dark-elevated hover:bg-brand-primary/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed group border border-dark-border/50 hover:border-brand-primary/50 hover-lift"
                  title="Видеозвонок"
                >
                  <svg className="w-5 h-5 text-brand-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </>
          )}
          {!otherUser && <h2 className="flex-1 text-xl font-bold text-white">Чат</h2>}
          <div className="relative">
            <button
              onClick={() => setShowChatMenu((v) => !v)}
              className="p-2.5 bg-dark-elevated hover:bg-dark-hover rounded-lg transition-all border border-dark-border/50 hover-lift"
              title="Меню чата"
            >
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
              </svg>
            </button>
            {showChatMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowChatMenu(false)}></div>
                <div className="absolute right-0 mt-2 w-56 z-50 glass-effect-dark rounded-xl border border-dark-border/50 shadow-2xl overflow-hidden animate-scale-in">
                  {otherUser && (blockState === 'blockedByMe' ? (
                    <button onClick={unblockUser} className="w-full text-left px-4 py-3 text-sm text-white hover:bg-dark-hover transition-colors">Разблокировать</button>
                  ) : (
                    <button onClick={blockUser} disabled={blockState === 'blockedMe'} className="w-full text-left px-4 py-3 text-sm text-brand-danger hover:bg-brand-danger/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Заблокировать</button>
                  ))}
                  <button onClick={deleteChatForSelf} className="w-full text-left px-4 py-3 text-sm text-white hover:bg-dark-hover transition-colors border-t border-dark-border/50">Удалить чат у себя</button>
                  <button onClick={deleteChatForBoth} className="w-full text-left px-4 py-3 text-sm text-brand-danger hover:bg-brand-danger/10 transition-colors border-t border-dark-border/50">Удалить у обоих</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {messages.map((msg) => {
          const isOwn = msg.sender_id === user.id;
          const senderColor = msg.sender?.custom_color || '#6366F1';

          return (
            <div
              key={msg.id}
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group animate-fade-in-up`}
              onContextMenu={(e) => handleContextMenu(e, msg)}
            >
              {!isOwn && (
                <div
                  className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold mr-3 cursor-pointer hover:shadow-glow transition-all flex-shrink-0 shadow-md overflow-hidden"
                  style={msg.sender?.avatar_url ? { backgroundImage: `url(${msg.sender.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                  onClick={() => setSelectedUserId(msg.sender_id)}
                >
                  {!msg.sender?.avatar_url && msg.sender?.username?.[0]?.toUpperCase()}
                </div>
              )}
              
              <div className={`max-w-md relative ${
                isOwn 
                  ? 'bg-gradient-to-br from-brand-primary to-brand-secondary text-white shadow-lg' 
                  : 'glass-effect text-white'
              } rounded-2xl px-4 py-3`}>
                {!isOwn && room.is_group && (
                  <div className="text-sm font-bold mb-1.5" style={{ color: senderColor }}>
                    {msg.sender?.username}
                  </div>
                )}

                {msg.reply_to_id && (
                  <div className="text-xs opacity-70 mb-2 pl-3 border-l-2 border-white/30 py-1">
                    Ответ на сообщение
                  </div>
                )}

                {msg.image_url && (
                  <img
                    src={msg.image_url}
                    alt="Изображение"
                    className="max-w-xs rounded-xl mb-2 cursor-pointer hover:opacity-90 transition-opacity shadow-md"
                    onClick={() => window.open(msg.image_url, '_blank')}
                  />
                )}

                {msg.file_url && (
                  <a
                    href={msg.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all mb-2 ${
                      isOwn ? 'bg-white/10 hover:bg-white/20' : 'bg-dark-hover hover:bg-dark-accent'
                    }`}
                  >
                    <div className="p-2 bg-white/10 rounded-lg">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{msg.file_name}</div>
                      <div className="text-xs opacity-70">Нажмите для скачивания</div>
                    </div>
                  </a>
                )}

                {msg.content && <div className="text-[15px] leading-relaxed break-words">{msg.content}</div>}

                <div className={`flex items-center gap-2 mt-2 text-xs ${isOwn ? 'opacity-80' : 'opacity-60'}`}>
                  <span>{new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                  {msg.is_edited && <span>• изменено</span>}
                  {isOwn && <span>{getMessageStatus(msg)}</span>}
                </div>

                {/* Hover buttons */}
                <div className="absolute -top-10 right-0 hidden group-hover:flex gap-1 glass-effect-dark rounded-xl p-1.5 shadow-lg animate-slide-down">
                    <button
                      onClick={() => setReplyTo(msg)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      title="Ответить"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>
                    {isOwn && (
                      <>
                    <button
                      onClick={() => openEditModal(msg)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      title="Редактировать"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setDeletingMessage(msg)}
                      className="p-2 hover:bg-brand-danger/20 rounded-lg transition-colors text-brand-danger"
                      title="Удалить"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                      </>
                    )}
                  </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-dark-border/50 p-4 backdrop-blur-xl bg-dark-surface/50">
        {replyTo && (
          <div className="mb-3 p-3 glass-effect rounded-xl flex items-center justify-between animate-slide-down">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="text-sm text-gray-300">Ответ на: <span className="text-white">{(replyTo.content || replyTo.file_name || '📷 Изображение').slice(0, 50)}</span></span>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {blockState !== 'none' && (
          <div className="mb-3 p-3 rounded-xl bg-brand-danger/10 border border-brand-danger/30 text-sm text-brand-danger text-center">
            {blockState === 'blockedByMe'
              ? 'Вы заблокировали этого пользователя. Снимите блокировку в меню чата (⋮), чтобы продолжить переписку.'
              : 'Этот пользователь ограничил переписку с вами.'}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex gap-3">
          <input
            id="image-upload"
            type="file"
            accept="*/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => document.getElementById('image-upload').click()}
            disabled={uploading || blockState !== 'none'}
            className="p-3 bg-dark-elevated hover:bg-dark-hover border border-dark-border/50 rounded-xl transition-all disabled:opacity-50 hover-lift"
            title="Прикрепить файл"
          >
            {uploading ? (
              <svg className="animate-spin h-5 w-5 text-brand-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={blockState !== 'none' ? 'Переписка недоступна' : 'Напишите сообщение...'}
            disabled={blockState !== 'none'}
            className="input-field flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || blockState !== 'none'}
            className="px-6 py-3 bg-gradient-to-r from-brand-primary to-brand-secondary hover:shadow-glow rounded-xl font-semibold transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 glass-effect-dark border border-dark-border/50 rounded-xl shadow-2xl py-2 min-w-[180px] animate-scale-in"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                setReplyTo(contextMenu.message);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2.5 text-left hover:bg-white/10 transition-colors flex items-center gap-3 text-white"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span>Ответить</span>
            </button>
            {contextMenu.message.sender_id === user.id && (
              <>
                <button
                  onClick={() => openEditModal(contextMenu.message)}
                  className="w-full px-4 py-2.5 text-left hover:bg-white/10 transition-colors flex items-center gap-3 text-white"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Редактировать</span>
                </button>
                <div className="my-1 border-t border-dark-border/30"></div>
                <button
                  onClick={() => {
                    setDeletingMessage(contextMenu.message);
                    setContextMenu(null);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-brand-danger/20 transition-colors text-brand-danger flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Удалить</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {selectedUserId && (
        <UserProfileModal
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onOpenFullProfile={(profile) => {
            setSelectedUserId(null);
          }}
        />
      )}

      {/* Модальное окно редактирования */}
      {editingMessage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setEditingMessage(null)}>
          <div className="glass-effect-dark rounded-2xl w-full max-w-md p-6 shadow-2xl border border-dark-border/50 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Редактировать сообщение</h3>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              autoFocus
              className="input-field w-full resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditingMessage(null)} className="px-4 py-2 rounded-xl bg-dark-elevated hover:bg-dark-hover text-gray-300 transition-all">Отмена</button>
              <button onClick={submitEdit} disabled={!editContent.trim()} className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-semibold transition-all disabled:opacity-50">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно удаления */}
      {deletingMessage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setDeletingMessage(null)}>
          <div className="glass-effect-dark rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-dark-border/50 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Удалить сообщение?</h3>
            <p className="text-sm text-gray-400 mb-5">Это действие нельзя отменить.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingMessage(null)} className="px-4 py-2 rounded-xl bg-dark-elevated hover:bg-dark-hover text-gray-300 transition-all">Отмена</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-xl bg-brand-danger hover:shadow-lg text-white font-semibold transition-all">Удалить</button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
