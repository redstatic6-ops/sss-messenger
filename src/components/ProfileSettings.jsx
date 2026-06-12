import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

export default function ProfileSettings({ onClose }) {
  const { profile, setProfile } = useAuthStore();
  const [activeTab, setActiveTab] = useState('profile');
  const [formData, setFormData] = useState({
    username: profile?.username || '',
    bio: profile?.bio || '',
    avatar_url: profile?.avatar_url || '',
    banner_url: profile?.banner_url || '',
    custom_color: profile?.custom_color || '#5865F2'
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file, bucket) => {
    setUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${profile.id}/${Math.random()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      alert('Ошибка загрузки: ' + uploadError.message);
      setUploading(false);
      return null;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
    setUploading(false);
    return data.publicUrl;
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = await uploadFile(file, 'avatars');
    if (url) {
      setFormData({ ...formData, avatar_url: url });
    }
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = await uploadFile(file, 'banners');
    if (url) {
      setFormData({ ...formData, banner_url: url });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(formData)
        .eq('id', profile.id)
        .select()
        .single();

      if (error) {
        alert('Ошибка сохранения: ' + error.message);
      } else if (data) {
        setProfile(data);
        alert('Профиль сохранен!');
      }
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg w-full max-w-4xl h-[600px] flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-dark-bg p-4 space-y-2">
          <button
            onClick={() => setActiveTab('profile')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'profile' ? 'bg-blue-600' : 'hover:bg-dark-hover'
            }`}
          >
            Профиль
          </button>
          <button
            onClick={() => setActiveTab('appearance')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'appearance' ? 'bg-blue-600' : 'hover:bg-dark-hover'
            }`}
          >
            Внешний вид
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'privacy' ? 'bg-blue-600' : 'hover:bg-dark-hover'
            }`}
          >
            Приватность
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
              activeTab === 'account' ? 'bg-blue-600' : 'hover:bg-dark-hover'
            }`}
          >
            Аккаунт
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          <div className="p-6 border-b border-dark-border flex items-center justify-between">
            <h2 className="text-xl font-semibold">Настройки</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-dark-hover rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'profile' && (
              <div className="space-y-6">
                {/* Banner preview */}
                <div className="relative">
                  <div
                    className="h-32 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 cursor-pointer hover:opacity-90 transition-opacity"
                    style={formData.banner_url ? { backgroundImage: `url(${formData.banner_url})`, backgroundSize: 'cover' } : {}}
                    onClick={() => document.getElementById('banner-upload').click()}
                  >
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity rounded-lg">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <input
                    id="banner-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleBannerUpload}
                    className="hidden"
                  />
                  <div className="absolute -bottom-12 left-6">
                    <div
                      className="w-24 h-24 rounded-full border-4 border-dark-surface bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold cursor-pointer hover:opacity-90 transition-opacity relative group"
                      style={formData.avatar_url ? { backgroundImage: `url(${formData.avatar_url})`, backgroundSize: 'cover' } : {}}
                      onClick={() => document.getElementById('avatar-upload').click()}
                    >
                      {!formData.avatar_url && formData.username[0]?.toUpperCase()}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                    </div>
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                {uploading && (
                  <div className="text-center text-blue-400">
                    Загрузка изображения...
                  </div>
                )}

                <div className="mt-16 space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Имя пользователя
                      <button className="ml-2 text-gray-400 hover:text-white">
                        <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      О себе
                      <button className="ml-2 text-gray-400 hover:text-white">
                        <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </label>
                    <textarea
                      value={formData.bio}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-blue-500 resize-none"
                      placeholder="Расскажите о себе..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">URL аватара</label>
                    <input
                      type="url"
                      value={formData.avatar_url}
                      onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                      className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-blue-500"
                      placeholder="https://example.com/avatar.jpg"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">URL баннера</label>
                    <input
                      type="url"
                      value={formData.banner_url}
                      onChange={(e) => setFormData({ ...formData, banner_url: e.target.value })}
                      className="w-full px-4 py-2 bg-dark-bg border border-dark-border rounded-lg focus:outline-none focus:border-blue-500"
                      placeholder="https://example.com/banner.jpg"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Цвет профиля</label>
                  <p className="text-sm text-gray-400 mb-4">
                    Этот цвет будет использоваться для вашего ника в чатах
                  </p>
                  <div className="flex gap-4 items-center">
                    <label
                      className="relative w-20 h-20 rounded-xl cursor-pointer overflow-hidden border-2 border-dark-border hover:border-white/40 transition-colors shadow-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: formData.custom_color }} 
                    >
                      <input
                        type="color"
                        value={formData.custom_color}
                        onChange={(e) => setFormData({ ...formData, custom_color: e.target.value })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <svg className="w-6 h-6 text-white/90 drop-shadow pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </label>
                    <div>
                      <div className="text-lg font-semibold" style={{ color: formData.custom_color }}>
                        {formData.username}
                      </div>
                      <div className="text-sm text-gray-400">Предпросмотр · {formData.custom_color?.toUpperCase()}</div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-dark-border">
                  <h3 className="font-medium mb-2">Популярные цвета</h3>
                  <div className="grid grid-cols-8 gap-2">
                    {['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3BA55D', '#FAA61A', '#9B59B6'].map(color => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, custom_color: color })}
                        className="w-12 h-12 rounded-lg border-2 border-transparent hover:border-white transition-colors"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-4">
                <div className="p-4 bg-dark-bg rounded-lg">
                  <h3 className="font-medium mb-2">Статус онлайн</h3>
                  <p className="text-sm text-gray-400">
                    Другие пользователи видят, когда вы в сети
                  </p>
                </div>
                <div className="p-4 bg-dark-bg rounded-lg">
                  <h3 className="font-medium mb-2">Статус прочтения</h3>
                  <p className="text-sm text-gray-400">
                    Отправители видят, когда вы прочитали их сообщения
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="space-y-4">
                <div className="p-4 bg-dark-bg rounded-lg">
                  <h3 className="font-medium mb-2">Email</h3>
                  <p className="text-sm text-gray-400">{profile?.id}</p>
                </div>
                <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
                  <h3 className="font-medium mb-2 text-red-400">Удалить аккаунт</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Это действие необратимо. Все ваши данные будут удалены.
                  </p>
                  <button className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                    Удалить аккаунт
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-dark-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 hover:bg-dark-hover rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg transition-colors"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
