import { useState, useEffect } from 'react';
import type { Role } from '../types';

interface RoleSelectorProps {
  /** 选中的角色 ID */
  selectedRoleId: string | null;
  /** 选择角色回调 */
  onChange: (role: Role) => void;
}

/**
 * 角色选择组件
 * 从 /roles API 获取角色列表，卡片式布局展示
 */
export function RoleSelector({ selectedRoleId, onChange }: RoleSelectorProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取角色列表
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        setLoading(true);
        const response = await fetch('/roles');
        if (!response.ok) {
          throw new Error(`获取角色列表失败: ${response.status}`);
        }
        const data = await response.json();
        setRoles(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    };

    fetchRoles();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin-slow" />
        <span className="ml-3 text-sm text-slate-400">加载角色列表...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {roles.map((role) => {
        const isSelected = selectedRoleId === role.id;

        return (
          <button
            key={role.id}
            onClick={() => onChange(role)}
            className={`
              relative p-3 rounded-xl border transition-all duration-200 text-left
              ${
                isSelected
                  ? 'border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/20'
                  : 'border-white/10 bg-white/5 hover:border-purple-400/50 hover:bg-white/10'
              }
            `}
          >
            {/* 选中指示器 */}
            {isSelected && (
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            )}

            {/* 头像 */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center text-lg mb-2 overflow-hidden">
              {role.avatar ? (
                <img
                  src={role.avatar}
                  alt={role.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 图片加载失败时显示首字
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="text-white font-bold">
                  {role.name.charAt(0)}
                </span>
              )}
            </div>

            {/* 名称 */}
            <h3 className="text-sm font-medium text-white truncate">
              {role.name}
            </h3>

            {/* 描述 */}
            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
              {role.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
