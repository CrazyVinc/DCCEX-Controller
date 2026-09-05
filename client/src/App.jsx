import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout/Layout.jsx';
import { DesignerPage } from './pages/DesignerPage.jsx';
import { DispatchPage } from './pages/DispatchPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LivePage } from './pages/LivePage.jsx';
import { RollingStockPage } from './pages/RollingStockPage.jsx';
import { Settings } from './pages/settings.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/designer" element={<DesignerPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/dispatch" element={<DispatchPage />} />
        <Route path="/rollingstock" element={<RollingStockPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
