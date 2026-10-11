import { AuthForm } from '../components/AuthForm';
import { authApi } from '../lib/api';

export function LoginPage() {
  return (
    <AuthForm
      title="Log in"
      submitLabel="Log in"
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
      submit={authApi.login}
      footer={{ text: 'No account?', linkText: 'Register', to: '/register' }}
    />
  );
}
