import { ModuleTabs } from './ModuleSection';
import { Panel } from './Panel';
import { Preview } from './Preview';
import { Timeline } from './Timeline';

export function App() {
  return (
    <div className="app">
      <Panel />
      <main className="stage">
        <ModuleTabs />
        <Preview />
        <Timeline />
      </main>
    </div>
  );
}
