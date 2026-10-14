import { RecoveryRequestForm } from "@/components/account/recovery-request-form";
export const metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
};
export default function ForgotPasswordPage() {
  return <RecoveryRequestForm />;
}
