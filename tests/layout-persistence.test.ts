import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getLayouts: vi.fn(),
  saveLayout: vi.fn(),
  updateLayout: vi.fn(),
  deleteLayout: vi.fn(),
  activateLayout: vi.fn(),
}));

vi.mock('@/services/api', () => api);

import { useLayoutStore } from '@/store/layoutStore';

describe('P1.3 workspace persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayoutStore.setState({ savedLayouts: [], chartLayout: 'single' });
  });

  it('hydrates server layouts into the local layout model', async () => {
    api.getLayouts.mockResolvedValue([{ id: 'server-1', name: 'Trading', is_active: true, panel_config: { chartLayout: '4' }, updated_at: '2026-09-02T00:00:00Z' }]);
    await useLayoutStore.getState().hydrateLayouts();
    expect(useLayoutStore.getState().savedLayouts).toMatchObject([{ id: 'server-1', name: 'Trading', chartLayout: '4' }]);
    expect(useLayoutStore.getState().chartLayout).toBe('4');
    expect(api.activateLayout).not.toHaveBeenCalled();
  });

  it('updates local state only after durable save succeeds', async () => {
    api.saveLayout.mockResolvedValue({ id: 'server-2', name: 'Saved' });
    await useLayoutStore.getState().saveCurrentLayout('Saved');
    expect(api.saveLayout).toHaveBeenCalledOnce();
    expect(useLayoutStore.getState().savedLayouts[0].id).toBe('server-2');
  });

  it('activates a loaded layout before applying it locally', async () => {
    useLayoutStore.setState({ savedLayouts: [{ id: 'server-4', name: 'Options', chartLayout: '4', leftDock: { collapsed: false, width: 260 }, rightDock: { collapsed: false, width: 300 }, bottomPanel: { collapsed: false, height: 200, activeTab: 'positions' }, createdAt: '' }] });
    api.activateLayout.mockResolvedValue({ id: 'server-4', is_active: true });
    await useLayoutStore.getState().loadLayout('server-4');
    expect(api.activateLayout).toHaveBeenCalledWith('server-4');
    expect(useLayoutStore.getState().chartLayout).toBe('4');
    expect(useLayoutStore.getState().savedLayouts[0].isActive).toBe(true);
  });

  it('does not change local state when activation fails', async () => {
    useLayoutStore.setState({ chartLayout: 'single', savedLayouts: [{ id: 'server-5', name: 'Failed', chartLayout: '8-chart', leftDock: { collapsed: false, width: 260 }, rightDock: { collapsed: false, width: 300 }, bottomPanel: { collapsed: false, height: 200, activeTab: 'positions' }, createdAt: '' }] });
    api.activateLayout.mockRejectedValue(new Error('activation failed'));
    await expect(useLayoutStore.getState().loadLayout('server-5')).rejects.toThrow('activation failed');
    expect(useLayoutStore.getState().chartLayout).toBe('single');
  });

  it('renames and deletes through server CRUD before updating local state', async () => {
    useLayoutStore.setState({ savedLayouts: [{ id: 'server-3', name: 'Old', chartLayout: 'single', leftDock: { collapsed: false, width: 260 }, rightDock: { collapsed: false, width: 300 }, bottomPanel: { collapsed: false, height: 200, activeTab: 'positions' }, createdAt: '' }] });
    api.updateLayout.mockResolvedValue({ id: 'server-3', name: 'New' });
    api.deleteLayout.mockResolvedValue({ status: 'deleted' });
    await useLayoutStore.getState().renameLayout('server-3', 'New');
    expect(useLayoutStore.getState().savedLayouts[0].name).toBe('New');
    await useLayoutStore.getState().deleteLayout('server-3');
    expect(useLayoutStore.getState().savedLayouts).toEqual([]);
  });
});