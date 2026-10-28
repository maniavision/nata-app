import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import Home from './pages/Home.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import Support from './pages/Support.jsx';
import Copyright from './pages/Copyright.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Feedback from './pages/Feedback.jsx';
import RouteAlerts from './pages/RouteAlerts.jsx';
import { MarketplacePage, MoneyPage, TrustGrowthPage } from './pages/StaffMetrics.jsx';
import { sampleFeedback, sampleMetricsDemo, sampleRoutes, sampleStats } from './dev/sampleStats.js';

// Scroll to the hash target after navigating (e.g. "/#faq" from the privacy page), else to the top.
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollManager />
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
        <Route path="/support" element={<Support />} />
        <Route path="/copyright" element={<Copyright />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/marketplace" element={<MarketplacePage />} />
        <Route path="/dashboard/money" element={<MoneyPage />} />
        <Route path="/dashboard/trust" element={<TrustGrowthPage />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/routes" element={<RouteAlerts />} />
        {import.meta.env.DEV && (
          <>
            <Route path="/dashboard/preview" element={<Dashboard demoStats={sampleStats} demoMetrics={sampleMetricsDemo.metrics} />} />
            <Route path="/dashboard/marketplace/preview" element={<MarketplacePage demo={sampleMetricsDemo} />} />
            <Route path="/dashboard/money/preview" element={<MoneyPage demo={sampleMetricsDemo} />} />
            <Route path="/dashboard/trust/preview" element={<TrustGrowthPage demo={sampleMetricsDemo} />} />
            <Route path="/feedback/preview" element={<Feedback demoFeedback={sampleFeedback} />} />
            <Route path="/routes/preview" element={<RouteAlerts demoRoutes={sampleRoutes} />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </>
  );
}
