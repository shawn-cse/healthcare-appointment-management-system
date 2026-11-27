import { useState, type ReactNode } from 'react';

export interface Column<T> {
  heading: string;
  value: (row: T) => string | number;
  cell?: (row: T) => ReactNode;
}

export function SortableColumn({ name, sort, onChange, children }: {
  name: string; sort: string; onChange: (value: string) => void; children: ReactNode;
}) {
  const direction = sort === `${name}.asc` ? 'ascending' : sort === `${name}.desc` ? 'descending' : undefined;
  return <th scope="col" aria-sort={direction}>
    <button type="button" className="table-sort-button" onClick={() => onChange(`${name}.${direction === 'ascending' ? 'desc' : 'asc'}`)}>
      {children} {direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : ''}
    </button>
  </th>;
}

export function PageSizeControl({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const choices = [...new Set([15, 25, 50, 100, size])].sort((a, b) => a - b);
  return <select className="field-control" aria-label="Rows per page" value={size} onChange={(e) => onChange(Number(e.target.value))}>
    {choices.map((count) => <option value={count} key={count}>{count} rows</option>)}
  </select>;
}

export function ManagementTable<T>({ rows, columns, rowKey, filters, dateColumn = 0 }: {
  rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string | number; filters?: ReactNode; dateColumn?: number;
}) {
  const [query, setQuery] = useState('');
  const [column, setColumn] = useState(dateColumn);
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(15);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = rows.filter((row) => {
    const text = columns.map((item) => item.value(row)).join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    const l = columns[column].value(a), r = columns[column].value(b);
    const order = typeof l === 'number' && typeof r === 'number' ? l - r : String(l).localeCompare(String(r), undefined, { numeric: true });
    return descending ? -order : order;
  });
  const pages = Math.max(1, Math.ceil(results.length / size));
  const current = Math.min(page, pages);
  return <section className="panel management-table">
    <div className="management-table-tools">
      <input className="field-control" type="search" aria-label="Search table" placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
      {filters}
      <select className="field-control" aria-label="Sort direction" value={String(descending)} onChange={(e) => { setDescending(e.target.value === 'true'); setPage(1); }}>
        <option value="true">{column === dateColumn ? 'Newest first' : 'Descending'}</option><option value="false">{column === dateColumn ? 'Oldest first' : 'Ascending'}</option>
      </select>
      <PageSizeControl size={size} onChange={(next) => { setSize(next); setPage(1); }} />
    </div>
    <div className="excel-table-wrap"><table className="excel-grid-table"><thead><tr>
      {columns.map((item, i) => <th key={item.heading} scope="col" aria-sort={i === column ? descending ? 'descending' : 'ascending' : undefined}>
        <button type="button" onClick={() => { setDescending(i === column && !descending); setColumn(i); setPage(1); }}>{item.heading} {i === column && (descending ? '↓' : '↑')}</button>
      </th>)}
    </tr></thead><tbody>
      {results.length ? results.slice((current - 1) * size, current * size).map((row) => <tr key={rowKey(row)}>
        {columns.map((item) => <td key={item.heading}>{item.cell ? item.cell(row) : item.value(row)}</td>)}
      </tr>) : <tr><td colSpan={columns.length}>No matching records.</td></tr>}
    </tbody></table></div>
    <div className="management-table-tools"><span>{results.length} records · Page {current} of {pages}</span>
      <button type="button" className="button button-small button-outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
      <button type="button" className="button button-small button-outline" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
    </div>
  </section>;
}
