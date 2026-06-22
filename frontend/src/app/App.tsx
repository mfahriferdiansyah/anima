import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import './shell.css';

export function App() {
  // A data router (createBrowserRouter) rather than <BrowserRouter>, so the note
  // editor can gate navigation on unsaved edits via useBlocker (which requires a
  // data router context). Routes + the global toast layout live in ./routes.
  return <RouterProvider router={router} />;
}
