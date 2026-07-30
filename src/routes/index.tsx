// src/routes/index.tsx
import TestFlexLayout from '@/components/flex-layout-test';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <div className='h-full w-full'>
      <TestFlexLayout />
    </div>
  ),
});
