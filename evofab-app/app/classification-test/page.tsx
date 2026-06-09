import axios from "axios";
export default async function ClassificationTest() {
  // Call the external Python API directly from the server component
  const res = await fetch("http://localhost:8000/api/python", {
    cache: "no-store",
  });
  const data = await res.json();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Next.js + Python API</h1>
      <p className="mt-4 bg-gray-100 p-4 rounded">{data.message}</p>
    </main>
  );
}
