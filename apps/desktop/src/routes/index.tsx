// src/routes/index.tsx
import { EditorArea } from '@/components/editor-area';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: EditorArea,
});
