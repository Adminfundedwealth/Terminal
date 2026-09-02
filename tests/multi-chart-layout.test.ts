import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/store/appStore';
import { getChartGridDimensions, MultiChartPanel } from '@/components/MultiChartPanel';

vi.mock('@/components/ChartPanel', () => ({
  ChartPanel: ({ symbolOverride, timeframeOverride }: { symbolOverride?: { symbol: string } | null; timeframeOverride?: string }) => (
    React.createElement('div', {
      'data-testid': 'chart-pane',
      'data-symbol': symbolOverride?.symbol || '',
      'data-timeframe': timeframeOverride || '',
    })
  ),
}));

const symbols = [
  { token: 'NIFTY', symbol: 'NIFTY', segment: 'NSE' },
  { token: 'BANKNIFTY', symbol: 'BANKNIFTY', segment: 'NSE' },
  { token: 'RELIANCE', symbol: 'RELIANCE', segment: 'NSE' },
];

beforeEach(() => {
  useAppStore.setState({
    chartLayout: '2h',
    timeframe: '5',
    activeSymbol: { ...symbols[0], name: symbols[0].symbol, instrumentType: 'EQ', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
    watchlists: [{ id: 'test', name: 'Test', color: '#fff', items: symbols }],
  });
});

describe('multi-chart layout grid', () => {
  it.each([
    ['single', 1, 1, 1],
    ['2h', 2, 1, 2],
    ['2v', 1, 2, 2],
    ['4', 2, 2, 4],
    ['8-chart', 4, 2, 8],
  ] as const)('%s creates the expected stable grid', (layout, cols, rows, count) => {
    expect(getChartGridDimensions(layout)).toEqual({ cols, rows, count });
  });

  it.each([
    ['2h', 2],
    ['2v', 2],
    ['4', 4],
    ['8-chart', 8],
  ] as const)('renders %s as %d independent chart panes', (layout, count) => {
    useAppStore.setState({ chartLayout: layout });
    render(React.createElement(MultiChartPanel));

    expect(screen.getAllByTestId('chart-pane')).toHaveLength(count);
    expect(screen.getAllByRole('combobox', { name: /symbol$/ })).toHaveLength(count);
    expect(screen.getAllByRole('combobox', { name: /timeframe$/ })).toHaveLength(count);
  });

  it('keeps symbol and timeframe changes isolated when switching layouts', () => {
    render(React.createElement(MultiChartPanel));
    const symbolSelectors = screen.getAllByRole('combobox', { name: /symbol$/ });
    const timeframeSelectors = screen.getAllByRole('combobox', { name: /timeframe$/ });

    fireEvent.change(symbolSelectors[0], { target: { value: 'BANKNIFTY' } });
    fireEvent.change(timeframeSelectors[1], { target: { value: '15' } });

    let panes = screen.getAllByTestId('chart-pane');
    expect(panes[0]).toHaveAttribute('data-symbol', 'BANKNIFTY');
    expect(panes[0]).toHaveAttribute('data-timeframe', '5');
    expect(panes[1]).toHaveAttribute('data-symbol', 'NIFTY');
    expect(panes[1]).toHaveAttribute('data-timeframe', '15');

    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(screen.getAllByTestId('chart-pane')).toHaveLength(4);
    panes = screen.getAllByTestId('chart-pane');
    expect(panes[0]).toHaveAttribute('data-symbol', 'BANKNIFTY');
    expect(panes[1]).toHaveAttribute('data-timeframe', '15');
  });
});