import { Panel } from './Panel';
import { Preview } from './Preview';

export function App() {
  return (
    <div className="app">
      <Panel />
      <main className="stage">
        <Preview />
        <footer className="timeline">
          <button className="btn icon" disabled title="Animation arrives in milestone 4">▶</button>
          <input type="range" min={0} max={1} step={0.001} value={0} disabled />
          <span className="time">0.00 / 0.00 s</span>
        </footer>
      </main>
    </div>
  );
}
