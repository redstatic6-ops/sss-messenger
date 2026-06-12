import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  profileChannel: null,

  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      // Передаём JWT в Realtime-сокет: без этого при включённом RLS
      // подписки postgres_changes работают как анонимные и не получают
      // защищённые строки (заявки в друзья, сообщения, звонки) живьём.
      supabase.realtime.setAuth(session.access_token);
      set({ user: session.user });

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      set({ profile, loading: false });

      await supabase
        .from('profiles')
        .update({ is_online: true, last_seen: new Date().toISOString() })
        .eq('id', session.user.id);

      // Subscribe to profile changes for realtime updates (только если еще не подписаны)
      const existingChannel = get().profileChannel;
      if (!existingChannel) {
        const channel = supabase
          .channel(`profile:${session.user.id}`)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${session.user.id}`
          }, (payload) => {
            set({ profile: payload.new });
          })
          .subscribe();
        
        set({ profileChannel: channel });
      }
    } else {
      set({ loading: false });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // Обновляем токен Realtime при входе и при автообновлении токена,
        // чтобы RLS-подписки продолжали получать события.
        supabase.realtime.setAuth(session.access_token);
        set({ user: session.user });

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        set({ profile });
      } else {
        // Отписываемся от канала при выходе
        const channel = get().profileChannel;
        if (channel) {
          supabase.removeChannel(channel);
          set({ profileChannel: null });
        }
        set({ user: null, profile: null });
      }
    });
  },

  markOffline: async () => {
    const state = get();
    if (state.user) {
      try {
        await supabase
          .from('profiles')
          .update({ is_online: false, last_seen: new Date().toISOString() })
          .eq('id', state.user.id);
      } catch (e) {
        console.warn('markOffline error:', e);
      }
    }
  },

  markOnline: async () => {
    const state = get();
    if (state.user) {
      try {
        await supabase
          .from('profiles')
          .update({ is_online: true, last_seen: new Date().toISOString() })
          .eq('id', state.user.id);
      } catch (e) {
        console.warn('markOnline error:', e);
      }
    }
  },

  signOut: async () => {
    const state = get();
    if (state.user) {
      await supabase
        .from('profiles')
        .update({ is_online: false, last_seen: new Date().toISOString() })
        .eq('id', state.user.id);
    }
    
    // Отписываемся от канала
    if (state.profileChannel) {
      supabase.removeChannel(state.profileChannel);
    }
    
    await supabase.auth.signOut();
    set({ user: null, profile: null, profileChannel: null });
  }
}));
