import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VehicleLabApp } from './VehicleLabApp';
import './styles.css';

/** Vehicle Lab専用のReactルートをDOMへ描画する。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VehicleLabApp />
  </StrictMode>,
);
