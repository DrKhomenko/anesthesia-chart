import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { seed, requestPersist } from './db/db';
import './ui/styles.css';

registerSW({ immediate: true });
void seed().then(() => requestPersist());
createRoot(document.getElementById('root')!).render(<App />);
