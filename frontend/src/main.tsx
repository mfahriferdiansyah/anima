import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/theme/tokens.css';
import '@/theme/base.css';
import '@/theme/components.css';
import { BRAND_NAME } from '@/brand';
import { PrimitivesGallery } from '@/PrimitivesGallery';

document.title = BRAND_NAME;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrimitivesGallery />
  </StrictMode>,
);
