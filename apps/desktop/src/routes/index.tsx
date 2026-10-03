// src/routes/index.tsx
import FlexLayoutRoot from '@/components/flex-layout-root';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <div className='h-full w-full'>
      <FlexLayoutRoot />
    </div>
  ),
});
