/* Produktkatalog: macht aus «Hähnchen-Brustfilet XXL» (Lidl), «M-Classic Pouletbrust» (Migros) und
   «Naturafarm Poulet-Brüstli» (Coop) dasselbe Grundprodukt «Pouletbrust», damit sich Preise vergleichen lassen.
   Erkennt ausserdem Kategorie, Bio und die Packungsgrösse («500g», «4x125g», «6er»). */
(function () {
  "use strict";

  const KATEGORIEN = [
    { id: "gemuese", name: "Gemüse", icon: "gemuese" },
    { id: "fruechte", name: "Früchte", icon: "fruechte" },
    { id: "fleisch", name: "Fleisch & Fisch", icon: "fleisch" },
    { id: "milch", name: "Milch & Eier", icon: "milch" },
    { id: "kaese", name: "Käse", icon: "kaese" },
    { id: "brot", name: "Brot & Backwaren", icon: "brot" },
    { id: "vorrat", name: "Vorrat", icon: "vorrat" },
    { id: "tk", name: "Tiefkühl", icon: "tk" },
    { id: "getraenke", name: "Getränke", icon: "getraenke" },
    { id: "suesses", name: "Süsses & Snacks", icon: "suesses" },
    { id: "haushalt", name: "Haushalt & Pflege", icon: "haushalt" },
    { id: "anderes", name: "Anderes", icon: "anderes" }
  ];

  // Name | Kategorie | Grundeinheit (kg, l, Stk) | Stichwörter (ohne Leerzeichen; «!» = Produktart, schlägt Zutaten wie «Erdbeer»)
  const ROH = `
Rüebli|gemuese|kg|ruebli,rubli
Kartoffeln|gemuese|kg|kartoffeln,kartoffel,frühkartoffeln,raclettekartoffeln,gschwellti
Süsskartoffeln|gemuese|kg|susskartoffel
Zwiebeln|gemuese|kg|zwiebel,zwiebeln,schalotten
Frühlingszwiebeln|gemuese|Stk|fruhlingszwiebel,lauchzwiebel
Knoblauch|gemuese|kg|knoblauch
Lauch|gemuese|kg|lauch
Tomaten|gemuese|kg|tomaten,tomate,rispentomaten,fleischtomaten,rispen
Cherrytomaten|gemuese|kg|cherrytomaten,cherry,datteltomaten,dattelcherry,cocktailtomaten,snacktomaten
Gurke|gemuese|Stk|gurke,gurken,salatgurke,burken
Peperoni|gemuese|kg|peperoni,spitzpeperoni,snackpeperoni
Zucchetti|gemuese|kg|zucchetti
Aubergine|gemuese|kg|aubergine,auberginen
Brokkoli|gemuese|kg|brokkoli,broccoli
Blumenkohl|gemuese|kg|blumenkohl
Rosenkohl|gemuese|kg|!rosenkohl
Kohl|gemuese|kg|weisskohl,rotkohl,kabis,wirz,chinakohl,spitzkohl
Fenchel|gemuese|kg|fenchel
Sellerie|gemuese|kg|sellerie,stangensellerie,knollensellerie
Spinat|gemuese|kg|spinat,blattspinat
Kürbis|gemuese|kg|kurbis,butternuss,butternut,hokkaido
Champignons|gemuese|kg|champignons,champignon,pilze,egerlinge
Kopfsalat|gemuese|Stk|salat,kopfsalat,eisbergsalat,eisberg,lattich,batavia,gartnersalat
Nüsslisalat|gemuese|kg|nusslisalat,nussler,feldsalat
Rucola|gemuese|kg|rucola,rocket
Salatmischung|gemuese|kg|salatmischung,saladmix,mixsalat,schnittsalat,babyleaf
Mais|gemuese|kg|maiskolben,zuckermais,mais
Randen|gemuese|kg|randen,rande,rote bete,rotebete
Radieschen|gemuese|Stk|radieschen
Kaisergemüse|tk|kg|kaisergemuse,!gemusemischung,!gemusemix,wokgemuse,schweizergemuse,schweizer gemuse
Ingwer|gemuese|kg|ingwer
Avocado|fruechte|Stk|avocado,avocados,avacados
Schnittlauch|gemuese|Stk|schnittlauch
Petersilie|gemuese|Stk|petersilie,peterli
Basilikum|gemuese|Stk|basilikum
Koriander|gemuese|Stk|koriander
Kräuter|gemuese|Stk|krauter,dill,minze,rosmarin,thymian
Äpfel|fruechte|kg|apfel,aepfel,gala,braeburn,golden,jazz,pink lady,elstar,boskoop
Birnen|fruechte|kg|birne,birnen
Bananen|fruechte|kg|banane,bananen
Orangen|fruechte|kg|orange,orangen,blutorangen
Mandarinen|fruechte|kg|mandarinen,mandarine,clementinen,clementine
Zitronen|fruechte|kg|zitrone,zitronen,limette,limetten
Trauben|fruechte|kg|trauben,traube,!weintrauben
Erdbeeren|fruechte|kg|erdbeeren,erdbeere
Himbeeren|fruechte|kg|himbeeren
Heidelbeeren|fruechte|kg|heidelbeeren,blaubeeren
Beeren|fruechte|kg|beeren,beerenmix,brombeeren
Kiwi|fruechte|Stk|kiwi
Ananas|fruechte|Stk|ananas
Mango|fruechte|Stk|mango
Melone|fruechte|kg|melone,!wassermelone,honigmelone
Aprikosen|fruechte|kg|aprikose,aprikosen
Pfirsiche|fruechte|kg|pfirsich,pfirsiche,nektarinen
Zwetschgen|fruechte|kg|zwetschgen,pflaumen
Kirschen|fruechte|kg|kirschen
Datteln|fruechte|kg|datteln
Pouletbrust|fleisch|kg|pouletbrust,pouletbrustli,pouletbrustfilet,pouletfilet,brustfilet
Trutenbrust|fleisch|kg|!truten,!trute,!truthahn,!pute,!putenbrust
Pouletschenkel|fleisch|kg|pouletschenkel,pouletflugeli,flugeli,chickenwings,pouletunterschenkel
Poulet|fleisch|kg|poulet,pouletgeschnetzeltes,pouletstreifen
Gehacktes|fleisch|kg|gehacktes,rindshack,hackfleisch
Fleischbällchen|fleisch|kg|fleischballchen,hackballchen,meatballs,meatball,frikadellen,falscherhase
Rindfleisch|fleisch|kg|rind,rinds,rinder,rindfleisch,entrecote,steak,huft,rindshuft,siedfleisch,rindsgeschnetzeltes
Schweinefleisch|fleisch|kg|!schwein,schweins,kotelett,schweinsplatzli,schweinsfilet,cordonbleu
Kalbfleisch|fleisch|kg|kalb,kalbs,kalbsgeschnetzeltes
Lamm|fleisch|kg|lamm
Speck|fleisch|kg|speck,kochspeck,bratspeck,speckwurfeli,bacon,lardons
Schinken|fleisch|kg|schinken,hinterschinken,kochschinken,vorderschinken
Rohschinken|fleisch|kg|rohschinken,prosciutto,prosclutto,serrano,parma,coppa,bundnerfleisch,trockenfleisch,rohessspeck
Salami|fleisch|kg|salami,chorizo,salametti
Würste|fleisch|kg|wurst,wurste,!cervelat,!bratwurst,!salsiz,wienerli,schublig,lyoner,fleischkase,wienerli
Lachs|fleisch|kg|lachs,lachsfilet
Räucherlachs|fleisch|kg|rauchlachs,raucherlachs,raucher lachs,raucherjachs,smokedsalmon
Thunfisch|vorrat|kg|thon,thunfisch
Fisch|fleisch|kg|fisch,fischfilet,dorsch,kabeljau,pangasius,egli,forelle,zander,seelachs
Crevetten|fleisch|kg|crevetten,garnelen,shrimps,scampi
Tofu|fleisch|kg|tofu,!tempeh,seitan,quorn
Milch|milch|l|milch,vollmilch,milchdrink,milchdink,ubertmilch,uhtmilch,lactosefrei
Hafermilch|milch|l|hafermilch,haferdrink,!oatly,mandeldrink,sojadrink,mandelmilch,sojamilch
Rahm|milch|l|rahm,vollrahm,halbrahm,kaffeerahm,!saucenrahm,creme fraiche,cremefraiche,sauerrahm
Butter|milch|kg|butter,vorzugsbutter,kochbutter,die butter,diebutter
Joghurt|milch|kg|!joghurt,!jogurt,!yogurt,!griechischer
Joghurtdrink|milch|l|!joghurtdrink,!kefir,!bifidus,!biffdus,!activia
Quark|milch|kg|!quark,!magerquark,!rahmquark,!skyr
Frischkäse|kaese|kg|frischkase,cottagecheese,huttenkase,philadelphia
Eier|milch|Stk|eier,ei,konsumeier,freilandeier,bodenhaltung,trinkeier
Mozzarella|kaese|kg|mozzarella,burrata,mozarella
Feta|kaese|kg|feta,schafskase,hirtenkase
Parmesan|kaese|kg|parmesan,parmigiano,grana,granapadano
Hartkäse|kaese|kg|gruyere,greyerzer,emmentaler,appenzeller,tilsiter,sbrinz,hartkase,bergkase,asiago,asfago,pecorino,manchego
Halbhartkäse|kaese|kg|halbhartkase,malhhartkase,raclette,racletteka,gouda,edamer,tete de moine,butterkase,scheiben kase
Reibkäse|kaese|kg|reibkase,geriebener,!pizzakase,fondue,fondu
Weichkäse|kaese|kg|brie,camembert,weichkase,tomme,vacherin,gorgonzola
Brot|brot|kg|brot,ruchbrot,halbweiss,bauernbrot,vollkornbrot,kornbrot,ruchmehlbrot,laib,urdinkel,sauerteig
Toastbrot|brot|kg|toast,toastbrot,sandwichbrot
Zopf|brot|kg|zopf,butterzopf
Brötli|brot|Stk|brotli,weggli,semmel,brotchen,burli,laugenbrotli,bagels,bagel,pitta,fladenbrot
Baguette|brot|Stk|baguette,ciabatta,pariser
Gipfeli|brot|Stk|gipfeli,croissant,laugengipfeli
Tortillas|brot|Stk|tortilla,tortillas,wraps,wrap
Knäckebrot|brot|kg|knackebrot,zwieback,crackers,darvida
Teigwaren|vorrat|kg|!teigwaren,spaghetti,penne,fusilli,hornli,nudeln,farfalle,tagliatelle,lasagne,maccaroni,makkaroni,rigatoni,spatzli,knopfli,!ravioli,!tortellini,!gnocchi
Reis|vorrat|kg|reis,basmati,jasmin,risotto,arborio,langkorn
Couscous|vorrat|kg|couscous,bulgur,quinoa,polenta,hirse
Mehl|vorrat|kg|mehl,weissmehl,zopfmehl,ruchmehl,dinkelmehl
Zucker|vorrat|kg|zucker,rohrzucker,puderzucker
Haferflocken|vorrat|kg|haferflocken,flocken,porridge
Müesli|vorrat|kg|!muesli,!musli,granola,!cornflakes,!knuspermusli
Paniermehl|vorrat|kg|paniermehl,panko
Öl|vorrat|l|!ol,!olivenol,!rapsol,!sonnenblumenol,!bratol
Essig|vorrat|l|!essig,!balsamico,!aceto
Salz & Gewürze|vorrat|kg|salz,pfeffer,gewurz,paprikapulver,curry,kurkuma,zimt,muskat,oregano,bouillon,!aromat
Tomatenkonserven|vorrat|kg|pelati,passata,tomatenpuree,!gehacktetomaten,polpa,!tomatenmark
Hülsenfrüchte|vorrat|kg|kichererbsen,linsen,bohnen,kidneybohnen,weissebohnen,!erbsen
Mais in Dosen|vorrat|kg|maiskorner,!maisdose
Kokosmilch|vorrat|l|!kokosmilch,!coconutmilk
Saucen|vorrat|kg|!sauce,!ketchup,!mayonnaise,!mayo,!senf,!pesto,!sojasauce,!currypaste,!salatsauce,!dressing,!tomatensauce,!bbq
Hummus|vorrat|kg|!hummus,!humus,aufstrich,!guacamole,!tzatziki
Oliven & Kapern|vorrat|kg|oliven,kapern,capucines,!essiggurken,cornichons,!getrocknete tomaten
Nüsse|suesses|kg|nusse,baumnusse,haselnusse,mandeln,cashew,erdnusse,pinienkerne,kerne,studentenfutter,trockenfruchte
Honig|vorrat|kg|!honig
Konfitüre & Aufstriche|vorrat|kg|!konfiture,!konfi,!marmelade,!nutella,!erdnussbutter,!brotaufstrich
Kaffee|getraenke|kg|!kaffee,!kaffeebohnen,!espresso,!kapseln,!nespresso
Tee|getraenke|kg|!tee,!eistee,!krautertee,!schwarztee,!grunter
Mineralwasser|getraenke|l|!mineralwasser,!mineral,!wasser,henniez,valser,aproz,evian,!sprudel
Saft|getraenke|l|!saft,!orangensaft,!apfelsaft,!nektar,!smoothie,!schorle,!sussmost
Süssgetränke|getraenke|l|!cola,!colazero,!rivella,!fanta,!sprite,!limonade,!icetea,!energy,!redbull,!sirup
Bier|getraenke|l|!bier,!lager,!feldschlosschen,!quollfrisch,!heineken,!ipa
Wein|getraenke|l|!wein,!rotwein,!weisswein,!prosecco,!champagner,!merlot,!chasselas
Schokolade|suesses|kg|!schokolade,!chocolat,!schoggi,!praline,!pralinen,!toblerone,!lindt,!ragusa,!kitkat,!riegel
Guetzli|suesses|kg|!guetzli,!biscuits,!kekse,!cookies,!waffeln,!prussiens,!petitbeurre,!madeleines
Chips|suesses|kg|!chips,!snacks,!popcorn,!salzstangen,!brezeli,!nachos,!tortillachips
Glace|tk|kg|!glace,!eis,!eiscreme,!sorbet,!cornet,!magnum
Kuchen & Dessert|suesses|kg|!kuchen,!torte,!dessert,!pudding,!flan,!tiramisu,!mousse,!cake,!milchreis
Pommes Frites|tk|kg|!pommesfrites,!pommes,!frites,!wellenschn,!kroketten,!rosti,!hashbrowns
Pizza|tk|Stk|!pizza,!flammkuchen
Tiefkühlgemüse|tk|kg|!tkgemuse,!tiefkuhlgemuse,!erbsenundruebli,!rahmspinat
Fischstäbchen|tk|kg|!fischstabchen,!backfisch,!fischknusperli
Fertiggerichte|tk|kg|!fertiggericht,!lasagne fertig,!frischteig,!kuchenteig,!blatterteig,!pizzateig,!springrolls,!fruhlingsrollen,!dumplings
WC-Papier|haushalt|Stk|!wcpapier,!toilettenpapier,!klopapier
Haushaltpapier|haushalt|Stk|!haushaltpapier,!kuchenrolle,!taschentucher,!servietten
Abwaschmittel|haushalt|l|!abwaschmittel,!spulmittel,!geschirrspul,!tabs,!spulmaschinentabs
Waschmittel|haushalt|l|!waschmittel,!weichspuler,!waschpulver,!flussigwaschmittel
Putzmittel|haushalt|l|!putzmittel,!reiniger,!allzweckreiniger,!wcreiniger,!schwamm,!entkalker
Abfallsäcke|haushalt|Stk|!abfallsack,!abfallsacke,!kehrichtsack,!mullsack,!gebuhrensack
Körperpflege|haushalt|Stk|!zahnpasta,!zahnburste,!shampoo,!duschgel,!seife,!deo,!deodorant,!handcreme,!bodylotion,!rasier,!tampons,!binden,!wattestabchen
Tierfutter|anderes|kg|!katzenfutter,!hundefutter,!tierfutter
Blumen|anderes|Stk|!blumen,!rosen,!tulpen,!strauss,!pflanze
`;

  // Schreibweise vereinheitlichen: klein, ohne Umlaute/Akzente, ä/ae → a, Zeichen → Leerzeichen
  function norm(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
      .replace(/[^a-z0-9%]+/g, " ").trim();
  }
  // Gleichbedeutende Wörter (Deutschland/Schweiz, Marketing) auf ein Wort bringen
  const SYNONYME = [
    [/\b(hahnchen|huhnchen|hendl|chicken|hahnchenbrust)/g, "poulet"],
    [/\bpoulet (brust|brustfilet|brustfilets|brustli|filet|filets)\b/g, "pouletbrust"],
    [/sahne/g, "rahm"],
    [/\b(karotten?|mohren?|carottes?)\b/g, "rubli"],
    [/\bpaprika\b(?! ?pulver)/g, "peperoni"],
    [/\bzucchini\b/g, "zucchetti"],
    [/\b(faschiertes|hack)\b/g, "hackfleisch"],
    [/\b(yoghurt|jogurt|yogurt)/g, "joghurt"],
    [/\bporree\b/g, "lauch"],
    [/\btopfen\b/g, "quark"],
    [/\b(meat ?balls?|fleisch ?ballchen)\b/g, "meatballs"],
    [/\bpommes ?frites\b/g, "pommesfrites"],
    [/\b(wc|toiletten) ?papier/g, "wcpapier"],
    [/\bhaushalt ?s? ?papier/g, "haushaltpapier"],
    [/\bgemuse ?(mix|mischung)\b/g, "gemusemischung"],
    [/\bmineral ?wasser\b/g, "mineralwasser"],
    [/\bcreme fraiche\b/g, "cremefraiche"],
    [/\bcherry ?tomaten\b/g, "cherrytomaten"],
    [/\bdattel ?cherry ?tomaten\b/g, "cherrytomaten"],
    [/\bmilch ?drink\b/g, "milchdrink"],
    [/\bjoghurt ?drink\b/g, "joghurtdrink"],
    [/\bbrot ?aufstrich\b/g, "brotaufstrich"]
  ];
  const synonyme = t => { for (const [re, w] of SYNONYME) t = t.replace(re, w); return t; };

  const KATALOG = ROH.trim().split("\n").map(z => {
    const [name, kat, einheit, sw] = z.split("|");
    const stichwoerter = sw.split(",").map(s => ({ prio: s.startsWith("!"), w: synonyme(norm(s.replace(/^!/, ""))).replace(/ /g, "") })).filter(s => s.w.length >= 2);
    return { name, kat, einheit, stichwoerter, key: norm(name) };
  });
  const KAT = Object.fromEntries(KATEGORIEN.map(k => [k.id, k]));

  // Wörter, die nichts über das Produkt sagen (Marken, Labels, Grössen)
  const RAUSCHEN = /\b(m ?classic|m ?budget|budget|prix garantie|naturaplan|naturafarm|qualite ?& ?prix|qualite prix|betty bossi|fine food|karma|coop|migros|lidl|denner|aldi|anna s best|annas best|selection|terrasuisse|ip ?suisse|suisse garantie|fairtrade|max havelaar|demeter|knospe|xxl|xl|multipack|family|aktion|milbona|chef select|deluxe|favorina|crownfield|combino|vitasia|italiamo|solevita|freeway|alesto|nixe|gut bio|swiss|schweizer|ch|stk|stuck|pack|packung|beutel|schale|dose|glas|flasche|im|am|in|mit|und|der|die|das|des|von|natur|frisch|klassik|classic|original)\b/g;

  // Packungsgrösse aus dem Bon-Text: «500g», «1.5 l», «4x125g», «6er», «10 Stk»
  function groesse(text) {
    const t = String(text || "").toLowerCase().replace(/,/g, ".");
    const einheit = e => ({ gr: "g", g: "g", kg: "kg", l: "l", lt: "l", ltr: "l", dl: "dl", cl: "cl", ml: "ml" }[e]);
    let m = t.match(/(\d{1,2})\s*[x×]\s*(\d{1,4}(?:\.\d{1,3})?)\s*(kg|gr|g|ltr|lt|l|dl|cl|ml)\b/);
    if (m) return umrechnen(+m[1] * +m[2], einheit(m[3]));
    m = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*(kg|gr|g|ltr|lt|l|dl|cl|ml)\b(?!\s*[+%])/);
    if (m && +m[1] > 0) return umrechnen(+m[1], einheit(m[2]));
    m = t.match(/\b(\d{1,2})\s*(er|stk|stuck|st)\b/);
    if (m && +m[1] > 1) return { q: +m[1], e: "Stk" };
    return null;
  }
  function umrechnen(q, e) {
    if (e === "cl") return { q: Math.round(q * 10 * 100) / 100, e: "ml" };
    return { q: Math.round(q * 1000) / 1000, e };
  }
  const DIMENSION = { g: "kg", kg: "kg", ml: "l", dl: "l", l: "l", cl: "l", Stk: "Stk" };

  // Bon-Text → { name, kat, einheit, bio, groesse, sicher }
  function erkennen(text) {
    const roh = String(text || "");
    let t = synonyme(norm(roh));
    const bio = /\bbio\b|naturaplan|demeter|knospe|gut bio/.test(t) || /\bbio/i.test(roh);
    const ohne = t.replace(/\bbio\b/g, " ").replace(RAUSCHEN, " ").replace(/\s+/g, " ").trim();
    const z = ohne.replace(/ /g, ""), zAlle = t.replace(/ /g, "");
    let best = null, wert = 0, pos = 1e9;
    for (const p of KATALOG) for (const s of p.stichwoerter) {
      let i = z.indexOf(s.w); if (i < 0) { i = zAlle.indexOf(s.w); if (i < 0) continue; }
      // kurze Stichwörter nur als ganzes Wort (sonst steckt «ei» in jedem Wort)
      if (s.w.length <= 3 && !new RegExp("(^| )" + s.w + "( |$)").test(ohne)) continue;
      // Treffer nur über Füllwörter hinweg («m classic» + «lassi») zählen nicht
      if (z.indexOf(s.w) < 0 && s.w.length < 8) continue;
      const w = s.w.length + (s.prio ? 20 : 0);
      if (w > wert || (w === wert && i < pos)) { best = p; wert = w; pos = i; }
    }
    // Lesefehler der Texterkennung («Katsergemüse», «Prosclutto»): ein, zwei vertauschte Buchstaben zulassen
    let unscharf = false;
    if (!best) {
      const woerter = ohne.split(" ").filter(w => w.length >= 5);
      for (const p of KATALOG) for (const s of p.stichwoerter) {
        if (s.w.length < 5) continue;
        for (const w of woerter) {
          if (Math.abs(w.length - s.w.length) > 2) continue;
          const d = abstand(w, s.w), erlaubt = s.w.length >= 9 ? 2 : 1;
          if (d <= erlaubt) { const x = s.w.length - d + (s.prio ? 20 : 0); if (x > wert) { best = p; wert = x; } }
        }
      }
      unscharf = !!best;
    }
    let g = groesse(roh);
    if (g && best && DIMENSION[g.e] !== best.einheit) g = null;
    return best
      ? { name: best.name, kat: best.kat, einheit: best.einheit, bio, groesse: g, sicher: !unscharf }
      : { name: null, kat: "anderes", einheit: null, bio, groesse: g, sicher: false };
  }

  function abstand(a, b) {
    let v = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const n = [i];
      for (let j = 1; j <= b.length; j++) n[j] = Math.min(v[j] + 1, n[j - 1] + 1, v[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      v = n;
    }
    return v[b.length];
  }

  // Für die Auswahlliste: Katalog nach Suchbegriff ordnen
  function suchen(q, max = 8) {
    const k = synonyme(norm(q)), z = k.replace(/ /g, "");
    if (!z) return [];
    const treffer = [];
    for (const p of KATALOG) {
      let s = 0;
      if (p.key === k) s = 100;
      else if (p.key.startsWith(k)) s = 80;
      else if (p.key.includes(k)) s = 60;
      else for (const w of p.stichwoerter) { if (w.w.startsWith(z)) s = Math.max(s, 50); else if (z.length >= 4 && (w.w.includes(z) || z.includes(w.w))) s = Math.max(s, 35); }
      if (s) treffer.push([s, p]);
    }
    return treffer.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, max).map(x => x[1]);
  }
  const istBio = n => /\(Bio\)$/.test(String(n || ""));
  const ohneBio = n => String(n || "").replace(/\s*\(Bio\)$/, "");
  const mitBio = (n, bio) => ohneBio(n) + (bio ? " (Bio)" : "");
  // Kategorie eines (Grund-)Produktnamens
  function kategorieVon(n) {
    const k = norm(ohneBio(n)), p = KATALOG.find(x => x.key === k);
    return p ? p.kat : erkennen(n).kat;
  }

  window.Produkte = { KATEGORIEN, KAT, KATALOG, norm, erkennen, groesse, suchen, kategorieVon, istBio, ohneBio, mitBio, DIMENSION };
})();
