import { createContext, useContext } from 'react';

/**
 * Absolute path of the note the surrounding editor is editing.
 *
 * Node views need it to resolve relative links, and they render through the
 * ProseMirror adapter's portals -- which live inside this provider's React
 * tree -- so ordinary context reaches them. The workspace root is deliberately
 * not carried here: it is global state, and `useWorkspace` already owns it.
 */
export const EditorNotePathContext = createContext('');

export const useEditorNotePath = () => useContext(EditorNotePathContext);
