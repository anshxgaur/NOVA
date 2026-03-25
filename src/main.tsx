// React App entry point
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { MyProvider } from './context/MyContext';

ReactDOM.render(
  <MyProvider>
    <App />
  </MyProvider>,
  document.getElementById('root')
);
