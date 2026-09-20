[out:json][timeout:180];
(
  node["amenity"~"^(pharmacy|doctors|hospital|library|school|college|community_centre|theatre|townhall|cinema|post_office|place_of_worship)$"](51.6071,-0.7311,51.6291,-0.6961);
  way["amenity"~"^(pharmacy|doctors|hospital|library|school|college|community_centre|theatre|townhall|cinema|place_of_worship)$"](51.6071,-0.7311,51.6291,-0.6961);
  node["shop"~"^(supermarket|department_store|mall|doityourself|convenience)$"](51.6071,-0.7311,51.6291,-0.6961);
  way["shop"~"^(supermarket|department_store|mall|doityourself)$"](51.6071,-0.7311,51.6291,-0.6961);
  node["leisure"~"^(sports_centre|fitness_centre|park|recreation_ground|stadium|pitch)$"](51.6071,-0.7311,51.6291,-0.6961);
  way["leisure"~"^(sports_centre|fitness_centre|park|recreation_ground|stadium)$"](51.6071,-0.7311,51.6291,-0.6961);
  node["railway"="station"](51.6071,-0.7311,51.6291,-0.6961);
  way["landuse"~"^(industrial|retail)$"](51.6071,-0.7311,51.6291,-0.6961);
)
;
out center tags;
