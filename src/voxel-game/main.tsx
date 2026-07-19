import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VoxelGameApp } from './VoxelGameApp';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Voxel Game root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <VoxelGameApp />
  </StrictMode>,
);
