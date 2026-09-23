import { Spin } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import AppLayout from './AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import MyWork from './pages/MyWork';
import Staff from './pages/Staff';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import CrossGroupReport from './pages/CrossGroupReport';

export default function App() {
  const { user, loading, isManager, canAssign } = useAuth();
  if (loading) return <Spin fullscreen />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="my-work" element={<MyWork />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="staff" element={<Staff />} />
        <Route path="notifications" element={<Notifications />} />
        {isManager && <Route path="settings" element={<Settings />} />}
        {canAssign && <Route path="reports/cross-group" element={<CrossGroupReport />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
