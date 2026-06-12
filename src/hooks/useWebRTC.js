import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Конфигурация ICE серверов (вынесена за пределы компонента, чтобы ссылка была стабильной)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Ждём завершения сбора ICE кандидатов, чтобы вшить их прямо в SDP.
// Это делает обмен устойчивым к гонкам подписки на канал (broadcast может теряться).
function waitForIceGathering(pc, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// Понятное сообщение об ошибке доступа к камере/микрофону
function getMediaErrorMessage(error) {
  const name = error && error.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Доступ к камере/микрофону запрещён. Разрешите доступ в настройках приложения (или браузера) и попробуйте снова.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Камера или микрофон не найдены. Проверьте, что устройство подключено.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Не удаётся получить доступ к камере/микрофону — возможно, устройство занято другим приложением.';
  }
  return 'Не удалось установить звонок: ' + ((error && error.message) || 'неизвестная ошибка');
}

/**
 * Хук для управления WebRTC звонками.
 *
 * ВАЖНО: используется один раз на верхнем уровне (MainLayout), а не внутри ChatWindow.
 * Это позволяет принимать входящие звонки независимо от того, какой чат открыт.
 */
export function useWebRTC(userId) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callStatus, setCallStatus] = useState('idle');
  const [currentCall, setCurrentCall] = useState(null);
  const [callRoomId, setCallRoomId] = useState(null);
  const [remoteUser, setRemoteUser] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const peerConnectionRef = useRef(null);
  const channelRef = useRef(null);
  const channelReadyRef = useRef(false);
  const currentCallRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const pendingOfferRef = useRef(null);
  const localOfferRef = useRef(null);
  const isCallerRef = useRef(false);
  const signalQueueRef = useRef([]);
  const cleanupRef = useRef(() => {});
  // Держим потоки в ref-ах, чтобы cleanup не зависел от устаревшего замыкания state.
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  // Обновление текущего звонка: ref выставляется СИНХРОННО, без задержки через useEffect.
  // Это устраняет гонку, когда sendSignal вызывался раньше, чем ref успевал обновиться.
  const updateCurrentCall = useCallback((call) => {
    currentCallRef.current = call;
    setCurrentCall(call);
  }, []);

  // Очистка ресурсов (использует ref-ы, поэтому всегда видит актуальные потоки)
  const cleanup = useCallback(() => {
    console.log('🧹 Очистка ресурсов');

    const ls = localStreamRef.current;
    if (ls) {
      ls.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    setLocalStream(null);

    const rs = remoteStreamRef.current;
    if (rs) {
      rs.getTracks().forEach((track) => track.stop());
    }
    remoteStreamRef.current = null;
    setRemoteStream(null);

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    localOfferRef.current = null;
    signalQueueRef.current = [];
    isCallerRef.current = false;

    updateCurrentCall(null);
    setCallRoomId(null);
    setRemoteUser(null);
    setCallStatus('idle');
    setIsAudioEnabled(true);
    setIsVideoEnabled(true);
  }, [updateCurrentCall]);

  // Всегда держим cleanupRef актуальным (для размонтирования и для обработчиков канала)
  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  // Отправка WebRTC-сигнала. Если канал ещё не готов — складываем в очередь.
  const sendSignal = useCallback(
    (signal) => {
      const call = currentCallRef.current;
      if (!call) {
        console.error('❌ Нет звонка для отправки сигнала');
        return;
      }

      const payload = {
        type: signal.type,
        data: signal.offer || signal.answer || signal.candidate,
        from: userId,
        to: call.caller_id === userId ? call.receiver_id : call.caller_id,
        callId: call.id
      };

      if (!channelRef.current || !channelReadyRef.current) {
        signalQueueRef.current.push(payload);
        return;
      }

      channelRef.current.send({
        type: 'broadcast',
        event: 'webrtc-signal',
        payload
      });
    },
    [userId]
  );

  // Служебные управляющие сообщения (например, запрос повторной отправки offer)
  const sendControl = useCallback(
    (action) => {
      const call = currentCallRef.current;
      if (!channelRef.current || !channelReadyRef.current || !call) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'call-control',
        payload: { action, from: userId, callId: call.id }
      });
    },
    [userId]
  );

  // Создание RTCPeerConnection
  const createPeerConnection = useCallback(
    (stream) => {
      console.log('🔗 Создание RTCPeerConnection');

      const pc = new RTCPeerConnection(ICE_SERVERS);

      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }

      // Trickle ICE (в дополнение к кандидатам, вшитым в SDP)
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: 'ice-candidate', candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        console.log('🔗 Получен удалённый трек:', event.track.kind);
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
          setRemoteStream(event.streams[0]);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('🔗 ICE состояние:', pc.iceConnectionState);
      };

      peerConnectionRef.current = pc;
      return pc;
    },
    [sendSignal]
  );

  // Применить накопленные ICE кандидаты
  const flushPendingCandidates = useCallback(async (pc) => {
    if (!pc || pendingCandidatesRef.current.length === 0) return;
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('❌ Ошибка добавления отложенного ICE кандидата:', error);
      }
    }
  }, []);

  // Обработка входящего offer (сторона, принимающая звонок)
  const processOffer = useCallback(
    async (offer) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
        // PeerConnection ещё не создан (звонок не принят) — сохраняем offer на потом
        pendingOfferRef.current = offer;
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);
        sendSignal({ type: 'answer', answer: pc.localDescription });
        console.log('📡 Answer отправлен');
      } catch (error) {
        console.error('❌ Ошибка обработки offer:', error);
      }
    },
    [flushPendingCandidates, sendSignal]
  );

  // Глобальная подписка на ВХОДЯЩИЕ звонки (по receiver_id, независимо от открытого чата)
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`incoming-calls:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        },
        async (payload) => {
          const call = payload.new;
          if (call.caller_id === userId) return;
          if (call.status !== 'ringing') return;
          // Уже заняты другим звонком — игнорируем
          if (currentCallRef.current) return;

          console.log('📞 Входящий звонок:', call.id);
          isCallerRef.current = false;
          pendingOfferRef.current = null;
          updateCurrentCall(call);
          setCallRoomId(call.room_id);
          setCallStatus('ringing');

          const { data: caller } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', call.caller_id)
            .single();
          if (caller) setRemoteUser(caller);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, updateCurrentCall]);

  // Подписка на сигнальный канал конкретного звонка (call:<roomId>)
  useEffect(() => {
    if (!userId || !callRoomId) return;

    console.log('📡 Подписка на сигнальный канал room:', callRoomId);

    const handleCallUpdate = (payload) => {
      const call = payload.new;
      console.log('📞 Обновление звонка:', call.status);

      if (
        call.status === 'declined' ||
        call.status === 'ended' ||
        call.status === 'cancelled'
      ) {
        // Звонок завершён удалённой стороной — освобождаем ресурсы.
        cleanupRef.current();
        return;
      }

      if (call.receiver_id === userId || call.caller_id === userId) {
        updateCurrentCall(call);
        if (call.status === 'active') {
          setCallStatus('active');
        }
      }
    };

    const handleSignal = async (payload) => {
      const { type, data, from } = payload.payload;
      if (from === userId) return;

      const pc = peerConnectionRef.current;
      console.log('📡 Получен сигнал:', type, 'от:', from);

      if (type === 'offer') {
        // Всегда сохраняем последний offer; обрабатываем только если PC готов (звонок принят)
        pendingOfferRef.current = data;
        if (peerConnectionRef.current) {
          await processOffer(data);
        }
      } else if (type === 'answer') {
        if (!pc) {
          console.error('❌ PeerConnection не создан для answer');
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          await flushPendingCandidates(pc);
        } catch (error) {
          console.error('❌ Ошибка обработки answer:', error);
        }
      } else if (type === 'ice-candidate') {
        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
          pendingCandidatesRef.current.push(data);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data));
        } catch (error) {
          console.error('❌ Ошибка добавления ICE кандидата:', error);
        }
      }
    };

    const handleControl = (payload) => {
      const { action, from } = payload.payload;
      if (from === userId) return;
      if (action === 'request-offer') {
        // Принимающая сторона попросила (пере)отправить offer
        if (isCallerRef.current && localOfferRef.current) {
          console.log('📡 Повторная отправка offer по запросу');
          sendSignal({ type: 'offer', offer: localOfferRef.current });
        }
      }
    };

    const channel = supabase
      .channel(`call:${callRoomId}`, {
        config: { broadcast: { self: false } }
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `room_id=eq.${callRoomId}`
        },
        handleCallUpdate
      )
      .on('broadcast', { event: 'webrtc-signal' }, handleSignal)
      .on('broadcast', { event: 'call-control' }, handleControl)
      .subscribe((status) => {
        console.log('📡 Статус канала:', status);
        if (status === 'SUBSCRIBED') {
          channelReadyRef.current = true;

          // Сбрасываем накопленную очередь сигналов
          const queued = signalQueueRef.current;
          signalQueueRef.current = [];
          for (const p of queued) {
            channel.send({ type: 'broadcast', event: 'webrtc-signal', payload: p });
          }

          // Звонящий: отправляем offer, как только канал готов
          if (isCallerRef.current && localOfferRef.current) {
            sendSignal({ type: 'offer', offer: localOfferRef.current });
          }

          // Принимающий, уже нажавший "Принять", но без offer — просим прислать
          if (
            !isCallerRef.current &&
            peerConnectionRef.current &&
            !pendingOfferRef.current
          ) {
            sendControl('request-offer');
          }
        }
      });

    channelRef.current = channel;

    return () => {
      console.log('📡 Отписка от сигнального канала');
      channelReadyRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [
    userId,
    callRoomId,
    sendSignal,
    sendControl,
    processOffer,
    flushPendingCandidates,
    updateCurrentCall
  ]);

  // Cleanup при размонтировании (через ref, чтобы не было устаревшего замыкания)
  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  // Начать звонок
  const startCall = async (roomId, callType = 'audio', otherUser = null) => {
    try {
      if (!roomId) return;
      console.log('🔵 Начало звонка:', callType);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Доступ к микрофону/камере недоступен. Требуется HTTPS или localhost.');
      }

      setCallStatus('calling');
      if (otherUser) setRemoteUser(otherUser);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video'
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Получаем ID другого пользователя
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId)
        .neq('user_id', userId)
        .limit(1)
        .maybeSingle();

      const receiverId = members?.user_id;
      if (!receiverId) {
        // Без получателя строка calls создаётся с receiver_id = null,
        // и входящий звонок никому не приходит. Прерываем с понятной ошибкой.
        throw new Error('Не удалось определить собеседника для звонка (это не личный чат?).');
      }

      const { data: call, error } = await supabase
        .from('calls')
        .insert({
          room_id: roomId,
          caller_id: userId,
          receiver_id: receiverId,
          call_type: callType,
          status: 'ringing'
        })
        .select()
        .single();

      if (error) throw error;

      console.log('🔵 Звонок создан в БД:', call.id);
      isCallerRef.current = true;
      updateCurrentCall(call);
      setCallRoomId(roomId);

      // Создаём соединение и offer (с вшитыми ICE кандидатами)
      const pc = createPeerConnection(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      localOfferRef.current = pc.localDescription;

      // Пытаемся отправить сразу; если канал ещё не готов — уйдёт из очереди / по запросу
      sendSignal({ type: 'offer', offer: pc.localDescription });
    } catch (error) {
      console.error('❌ Ошибка при начале звонка:', error);
      alert(getMediaErrorMessage(error));
      cleanup();
    }
  };

  // Принять звонок
  const acceptCall = async () => {
    try {
      console.log('🟢 Принятие звонка');
      const call = currentCallRef.current;
      if (!call) {
        console.error('❌ Звонок не найден');
        alert('Звонок больше недоступен — попробуйте ещё раз.');
        setCallStatus('idle');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Доступ к микрофону/камере недоступен. Требуется HTTPS или localhost.');
      }

      // Запрашиваем медиа в соответствии с типом звонка ТОЛЬКО после согласия.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: call.call_type === 'video'
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      createPeerConnection(stream);

      await supabase
        .from('calls')
        .update({ status: 'active', answered_at: new Date().toISOString() })
        .eq('id', call.id);

      setCallStatus('active');

      // Если offer уже пришёл — обрабатываем, иначе просим звонящего прислать
      if (pendingOfferRef.current) {
        await processOffer(pendingOfferRef.current);
      } else {
        sendControl('request-offer');
      }

      console.log('🟢 Звонок принят');
    } catch (error) {
      console.error('❌ Ошибка при принятии звонка:', error);
      alert(getMediaErrorMessage(error));
      declineCall();
    }
  };

  // Отклонить звонок
  const declineCall = async () => {
    console.log('🔴 Отклонение звонка');
    const call = currentCallRef.current;
    if (call) {
      await supabase
        .from('calls')
        .update({ status: 'declined', ended_at: new Date().toISOString() })
        .eq('id', call.id);
    }
    cleanup();
  };

  // Завершить звонок
  const endCall = async () => {
    console.log('⚫ Завершение звонка');
    const call = currentCallRef.current;
    if (call) {
      const startTime = call.answered_at || call.created_at;
      const duration = startTime
        ? Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)
        : 0;
      await supabase
        .from('calls')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString(),
          duration
        })
        .eq('id', call.id);
    }
    cleanup();
  };

  // Переключение микрофона
  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  // Переключение видео
  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  return {
    localStream,
    remoteStream,
    callStatus,
    currentCall,
    remoteUser,
    isAudioEnabled,
    isVideoEnabled,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleAudio,
    toggleVideo
  };
}
