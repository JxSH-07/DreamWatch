import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';

export default function NotFound({ embedded }) {
  const body = (
    <main className="center-screen">
      <div className="empty-state">
        <h1 className="h-cond" style={{ fontSize: 40 }}>Off the pitch</h1>
        <p>We couldn't find that page. The link may be wrong, or the party may have been deleted.</p>
        <Link to="/" className="btn btn-primary">Back to Home</Link>
      </div>
    </main>
  );
  if (embedded) return body;
  return <div className="page"><Header />{body}</div>;
}
