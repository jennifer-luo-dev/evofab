export default function PrintersLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
