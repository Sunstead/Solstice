import { create } from 'zustand';

import { nativePickers } from '@/lib/backend/native';
import { can } from '@/lib/backend/platform';

/** A centred confirmation: what's asked, and the button that goes ahead. */
export type Question = {
  title: string;
  message?: string;
  confirm: string;
  /** The button is red: going ahead loses something. */
  destructive?: boolean;
};

type Asking = Question & { answer: (yes: boolean) => void };

/** The question the web's dialog shows (`AskDialog`), when it isn't native. */
export const useAsking = create<{ asking: Asking | null }>(() => ({ asking: null }));

/**
 * Asks before something that can't be taken back (signing out, dropping
 * unsaved edits): UIKit's own alert in the iOS app, the app's alert dialog
 * elsewhere. Whether to go ahead.
 */
export async function ask(question: Question): Promise<boolean> {
  if (can.nativeViews) {
    const id = await nativePickers
      .alert(question.title, question.message, [
        { id: 'cancel', label: 'Cancel', style: 'cancel' },
        { id: 'confirm', label: question.confirm, style: question.destructive ? 'destructive' : 'default' },
      ])
      .catch(() => null);
    return id === 'confirm';
  }
  useAsking.getState().asking?.answer(false);
  return new Promise((resolve) => {
    useAsking.setState({
      asking: {
        ...question,
        answer: (yes) => {
          useAsking.setState({ asking: null });
          resolve(yes);
        },
      },
    });
  });
}
