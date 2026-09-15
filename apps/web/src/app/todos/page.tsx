import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: todos, error } = await supabase.from("todos").select();

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto", fontFamily: "var(--font-sans, sans-serif)" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1rem" }}>Supabase Todos Test</h1>
      {error && (
        <div style={{ padding: "1rem", backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: "6px", marginBottom: "1rem" }}>
          <strong>Error connecting to table:</strong> {error.message}
          <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
            Note: If the "todos" table does not exist in your Supabase project yet, create it in the Supabase Table Editor.
          </p>
        </div>
      )}
      {todos && todos.length === 0 && (
        <p style={{ color: "#666" }}>Connected to Supabase! The "todos" table is currently empty.</p>
      )}
      <ul style={{ listStyleType: "disc", paddingLeft: "1.5rem" }}>
        {todos?.map((todo: any) => (
          <li key={todo.id} style={{ margin: "0.5rem 0" }}>{todo.name || todo.title || JSON.stringify(todo)}</li>
        ))}
      </ul>
    </div>
  );
}
