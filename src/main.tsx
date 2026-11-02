import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import './ui/style.css';
import './ui/date-picker.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
