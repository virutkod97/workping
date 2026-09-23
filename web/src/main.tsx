import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { AuthProvider } from './auth';
import App from './App';
import { registerServiceWorker } from './push';

dayjs.locale('vi');
registerServiceWorker();
// Thông báo nổi (message) hiện dưới thanh trạng thái iPhone
const safeTop = parseFloat(getComputedStyle(document.querySelector('.safe-top') ?? document.body).height) || 0;
const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 10_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#1f4e78', borderRadius: 6 } }}>
      <AntApp message={{ top: safeTop + 8 }}>
        <QueryClientProvider client={qc}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
