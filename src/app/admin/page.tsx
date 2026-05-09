import { isAdmin } from "@/lib/auth";
import AdminDashboard from "./AdminDashboard";
import AdminLogin from "./AdminLogin";

export default async function AdminPage() {
  const admin = await isAdmin();
  return admin ? <AdminDashboard /> : <AdminLogin />;
}
