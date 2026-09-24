'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AnyTestResult } from '@/lib/types/tests';
import { Badge, EmptyState, StatusIcon, severityTone } from '@/components/ui/primitives';

const PAGE_SIZE = 50;

export type StatusFilter = 'all' | 'passed' | 'failed' | 'warnings' | 'critical';

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'warnings', label: 'Warnings' },
  { id: 'critical', label: 'Critical' },
  { id: 'passed', label: 'Passed' },
];

export function matchesStatusFilter(test: AnyTestResult, filter: StatusFilter): boolean {
  switch (filter) {
    case 'passed':
      return test.status === 'PASS';
    case 'failed':
      return test.status === 'FAIL';
    case 'warnings':
      return test.status === 'WARNING';
    case 'critical':
      return test.severity === 'critical';
    default:
      return true;
  }
}

interface TestTableProps {
  tests: AnyTestResult[];
  categories: string[];
  onSelect: (test: AnyTestResult) => void;
  selectedId?: string | null;
  /** Shows a viewport column — used by the responsive tables. */
  showViewport?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

export function TestTable({
  tests,
  categories,
  onSelect,
  selectedId,
  showViewport,
  emptyTitle = 'No tests match these filters',
  emptyBody = 'Try widening the filter, or clear the search to see every check.',
}: TestTableProps) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const counts = useMemo(
    () => ({
      all: tests.length,
      passed: tests.filter((t) => t.status === 'PASS').length,
      failed: tests.filter((t) => t.status === 'FAIL').length,
      warnings: tests.filter((t) => t.status === 'WARNING').length,
      critical: tests.filter((t) => t.severity === 'critical').length,
    }),
    [tests],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tests.filter((test) => {
      if (!matchesStatusFilter(test, status)) return false;
      if (category !== 'all' && test.category !== category) return false;
      if (!needle) return true;
      return (
        test.id.toLowerCase().includes(needle) ||
        test.element.toLowerCase().includes(needle) ||
        test.title.toLowerCase().includes(needle) ||
        (test.selector ?? '').toLowerCase().includes(needle)
      );
    });
  }, [tests, status, category, query]);

  const visible = filtered.slice(0, limit);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised p-1">
          {STATUS_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              active={status === filter.id}
              onClick={() => {
                setStatus(filter.id);
                setLimit(PAGE_SIZE);
              }}
              count={counts[filter.id]}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>

        {categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-raised p-1">
            <FilterChip
              active={category === 'all'}
              onClick={() => {
                setCategory('all');
                setLimit(PAGE_SIZE);
              }}
            >
              All types
            </FilterChip>
            {categories.map((name) => (
              <FilterChip
                key={name}
                active={category === name}
                onClick={() => {
                  setCategory(name);
                  setLimit(PAGE_SIZE);
                }}
                count={tests.filter((t) => t.category === name).length}
              >
                {name}
              </FilterChip>
            ))}
          </div>
        )}

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Filter by element, id or selector…"
          className="h-8 min-w-[200px] flex-1 rounded-lg border border-line bg-raised px-3 text-[12.5px] text-ink placeholder:text-faint focus:border-brand"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-raised/60">
                <Th className="w-[86px]">Test</Th>
                <Th className="w-[210px]">Element</Th>
                {showViewport && <Th className="w-[104px]">Viewport</Th>}
                <Th>Expected</Th>
                <Th>Actual</Th>
                <Th className="w-[136px]">Difference</Th>
                <Th className="w-[104px]">Status</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((test) => (
                <tr
                  key={test.id}
                  onClick={() => onSelect(test)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(test);
                    }
                  }}
                  className={clsx(
                    'cursor-pointer border-b border-line/70 transition-colors last:border-0',
                    selectedId === test.id ? 'bg-brand/8' : 'hover:bg-raised/70',
                  )}
                >
                  <Td>
                    <span className="font-mono text-[11.5px] text-brand">{test.id}</span>
                  </Td>
                  <Td>
                    <span className="block truncate text-[12.5px] text-ink" title={test.element}>
                      {test.element}
                    </span>
                    <span className="block truncate text-[11px] text-faint" title={test.title}>
                      {test.title}
                    </span>
                  </Td>
                  {showViewport && (
                    <Td>
                      <span className="font-mono text-[11.5px] text-muted">
                        {test.kind === 'ui' ? '—' : test.viewportLabel}
                      </span>
                    </Td>
                  )}
                  <Td>
                    <span className="block truncate font-mono text-[12px] text-muted" title={test.expected}>
                      {test.expected}
                    </span>
                  </Td>
                  <Td>
                    <span className="block truncate font-mono text-[12px] text-ink" title={test.actual}>
                      {test.actual}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={clsx(
                        'block truncate font-mono text-[12px]',
                        test.status === 'PASS' ? 'text-faint' : 'text-ink',
                      )}
                      title={test.difference}
                    >
                      {test.difference}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <StatusIcon status={test.status} />
                      {test.severity !== 'none' ? (
                        <Badge tone={severityTone(test.severity)}>{test.severity}</Badge>
                      ) : (
                        <span className="text-[11.5px] text-faint">pass</span>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > visible.length && (
        <button
          onClick={() => setLimit((l) => l + PAGE_SIZE * 2)}
          className="mt-3 w-full rounded-lg border border-line bg-raised py-2 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Show {Math.min(PAGE_SIZE * 2, filtered.length - visible.length)} more ·{' '}
          <span className="tabular font-mono">{filtered.length - visible.length}</span> remaining
        </button>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
        active ? 'bg-brand text-on-brand' : 'text-muted hover:bg-overlay hover:text-ink',
      )}
    >
      {children}
      {typeof count === 'number' && (
        <span className={clsx('tabular ml-1.5 font-mono text-[10.5px]', active ? 'opacity-70' : 'text-faint')}>
          {count}
        </span>
      )}
    </button>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={clsx(
        'px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-faint',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="max-w-0 px-3 py-2.5 align-middle">{children}</td>;
}
