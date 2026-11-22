// The derived publication structure as a tree the reader opens level by level. A node renders its children only when it is open, and a long list of
// children is cut to a page with "Show more", so a preview of thousands of data modules stays light.

import { useState } from 'react';
import type { StructDm, StructModule } from '../../../api/sns';
import { Icon } from '../../../components/Icon';
import { ShowMore } from '../../../components/lists';
import { Badge } from '../../../components/ui';
import { cap } from '../../../lib/importPackage';
import { countDms, levelName, plural } from '../../../lib/sns';

const ROOTS = 25;
const CHILDREN = 50;

function DmLeaf({ dm }: { dm: StructDm }) {
  return (
    <li data-testid="sns-struct-dm" data-file={dm.file} data-match={dm.match} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '3px 0', fontSize: 12.5 }}>
      <Icon name="file" size={13} />
      <span style={{ overflowWrap: 'anywhere' }}>{dm.title || dm.dmc}</span>
      <span className="v2-mono v2-hint">{dm.dmc}</span>
      {dm.infoCode ? <Badge title="Information code">{dm.infoCode}</Badge> : null}
      {dm.match === 'partial' ? <Badge tone="warn" title={dm.missing?.length ? `The SNS does not define: ${dm.missing.join(', ')}` : 'Not fully matched'}>{dm.missing?.length ? `no row for ${dm.missing.join(', ')}` : 'partly matched'}</Badge> : null}
    </li>
  );
}

function ModuleNode({ node, defaultOpen }: { node: StructModule; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [shown, setShown] = useState(CHILDREN);
  const n = countDms(node);
  const view = cap(node.children, shown);
  return (
    <li data-testid="sns-struct-node" data-code={node.code} data-level={node.level}>
      <button type="button" className="v2-chap" aria-expanded={open} onClick={() => setOpen(!open)} style={{ height: 'auto', minHeight: 28, padding: '3px 8px 3px 4px' }}>
        <Icon name={open ? 'down' : 'right'} size={14} />
        {node.code ? <span className="v2-mono">{node.code}</span> : null}
        <span style={{ textAlign: 'left', overflowWrap: 'anywhere' }}>{node.title}</span>
        <span className="v2-hint">{levelName(node.level)} &middot; {plural(n, 'data module')}</span>
      </button>
      {open ? (
        <ul className="v2-tree">
          {view.items.map((c) => (c.kind === 'dm' ? <DmLeaf key={c.file} dm={c} /> : <ModuleNode key={c.id} node={c} defaultOpen={false} />))}
          {view.hidden > 0 ? <li><ShowMore shown={shown} total={node.children.length} page={CHILDREN} noun="entries" onShown={setShown} /></li> : null}
        </ul>
      ) : null}
    </li>
  );
}

export function StructureView({ roots }: { roots: StructModule[] }) {
  const [shown, setShown] = useState(ROOTS);
  const view = cap(roots, shown);
  return (
    <div data-testid="sns-structure">
      <ul className="v2-tree">{view.items.map((r) => <ModuleNode key={r.id} node={r} defaultOpen={roots.length <= 3} />)}</ul>
      <ShowMore shown={shown} total={roots.length} page={ROOTS} noun="chapters" testid="sns-structure-more" onShown={setShown} />
    </div>
  );
}
