import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { GameErrorBoundary, GameLoading } from './ui/GameStatus';
import './styles.css';

const VoxelGameApp = lazy(() => import('./VoxelGameApp').then((module) => ({ default: module.VoxelGameApp })));

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Voxel Game root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <GameErrorBoundary>
      <Suspense fallback={<GameLoading />}><VoxelGameApp /></Suspense>
    </GameErrorBoundary>
  </StrictMode>,
);
