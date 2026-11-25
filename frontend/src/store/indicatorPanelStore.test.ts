import { beforeEach, describe, expect, it } from 'vitest';
import { useIndicatorPanelStore } from './indicatorPanelStore';

const store = () => useIndicatorPanelStore.getState();

beforeEach(() => useIndicatorPanelStore.setState({ open: false, focusId: null }));

describe('T7.4 indicator panel focus', () => {
  it('opens focused on an instance; toggling or closing clears the focus', () => {
    store().openFor('ind-3');
    expect(store()).toMatchObject({ open: true, focusId: 'ind-3' });
    store().toggle();
    expect(store()).toMatchObject({ open: false, focusId: null });
    store().toggle();
    expect(store()).toMatchObject({ open: true, focusId: null });
    store().openFor('ind-1');
    store().close();
    expect(store()).toMatchObject({ open: false, focusId: null });
  });
});
