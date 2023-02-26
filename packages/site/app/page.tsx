import "../styles/global.css";
import { Hero } from "./Hero";
import { Features } from "./Features";
import { Subscribe } from "./Subscribe";

const HomePage = () => {
  return (
    <main className="overflow-hidden">
      <Hero />
      <Features />
      <Subscribe />
    </main>
  );
};

export default HomePage;
