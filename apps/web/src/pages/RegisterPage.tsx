import { AuthForm } from '../components/AuthForm';
import { authApi } from '../lib/api';

export function RegisterPage() {
  return (
    <AuthForm
      title="Create an account"
      submitLabel="Register"
      fields={[
        { name: 'username', label: 'Username', type: 'text', autoComplete: 'username' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
      ]}
      submit={authApi.register}
      footer={{ text: 'Already have an account?', linkText: 'Log in', to: '/login' }}
    />
  );
}
