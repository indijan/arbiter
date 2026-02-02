import LoginForm from "@/components/LoginForm";
import SessionRedirect from "@/components/SessionRedirect";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <SessionRedirect />
      <LoginForm />
    </div>
  );
}
