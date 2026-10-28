// Titled lists used by the Privacy Policy, Support and Copyright pages.
export default function LegalSections({ sections }) {
  return sections.map((section) => (
    <section key={section.title}>
      <h2>{section.title}</h2>
      <ul>
        {section.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  ));
}
