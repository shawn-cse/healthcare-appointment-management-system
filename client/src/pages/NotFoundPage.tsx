import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/Layout.tsx';

export default function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="container" style={{ padding: '72px 16px' }}>
        <div className="panel empty-state" style={{ maxWidth: 560, margin: '0 auto', padding: 42 }}>
          <p className="eyebrow">404 NOT FOUND</p>
          <h1>Page Not Found</h1>
          <p className="muted">
            The clinical page or portal route you requested could not be located.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 18 }}>
            <Link className="button button-primary" to="/">
              Return Home
            </Link>
            <Link className="button button-outline" to="/doctors">
              Browse Doctors
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
