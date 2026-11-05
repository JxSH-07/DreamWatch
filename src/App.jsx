import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Loader } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Watch from './pages/Watch.jsx';
import Lobby from './pages/Lobby.jsx';
import Room from './pages/Room.jsx';
import Invite from './pages/Invite.jsx';
import NotFound from './pages/NotFound.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page"><Loader /></div>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/watch/:matchId" element={<RequireAuth><Watch /></RequireAuth>} />
      <Route path="/party/:partyId/lobby" element={<RequireAuth><Lobby /></RequireAuth>} />
      <Route path="/party/:partyId" element={<RequireAuth><Room /></RequireAuth>} />
      <Route path="/invite/:partyId" element={<RequireAuth><Invite /></RequireAuth>} />
      <Route path="*" element={<RequireAuth><NotFound /></RequireAuth>} />
    </Routes>
  );
}
