/**
 * NASA photographs for the habitat choices on the Rank page.
 * The radio label names the preset. The picture is the NASA photograph, not a drawing of that preset.
 */

const PHOTOS: Record<string, { src: string; alt: string }> = {
  iss: {
    src: "/images/habitats/iss.jpg",
    alt: "The International Space Station, photographed from Space Shuttle Endeavour. NASA, s123e010116.",
  },
  moon_base: {
    src: "/images/habitats/moon-base.jpg",
    alt: "The Apollo 14 lunar module on the Moon. NASA, as14-66-09277.",
  },
  rover: {
    src: "/images/habitats/rover.jpg",
    alt: "The Apollo 15 lunar rover at Hadley Rille. NASA, as15-86-11603.",
  },
  moon_base_upper_pressure: {
    src: "/images/habitats/moon-surface.jpg",
    alt: "Harrison Schmitt beside a boulder on the Apollo 17 lunar surface. NASA, as17-140-21496.",
  },
  spacesuit: {
    src: "/images/habitats/spacesuit.jpg",
    alt: "Astronauts in spacesuits in the station airlock. NASA, s114e6925.",
  },
  mars_habitat: {
    src: "/images/habitats/mars.jpg",
    alt: "The Martian surface, photographed by Perseverance. NASA, PIA25172.",
  },
  earth_sea_level: {
    src: "/images/habitats/earth.jpg",
    alt: "Earth, photographed by the Apollo 17 crew. NASA, as17-148-22727.",
  },
};

export function hasHabitatPhoto(id: string): boolean {
  return id in PHOTOS;
}

export function HabitatArt({ id }: { id: string }) {
  const photo = PHOTOS[id];
  if (!photo) return null;
  return <img src={photo.src} alt={photo.alt} className="aspect-[10/7] w-full rounded-md object-cover" />;
}
