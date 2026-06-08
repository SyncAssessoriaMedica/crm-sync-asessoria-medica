import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase-pagination";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export type ServiceAreaCity = {
  city: string;
  state: string;
  priority?: "primary" | "secondary" | "occasional";
};

export type ServiceAreaSettings = {
  enabled: boolean;
  primaryCity: string;
  primaryState: string;
  servedCities: ServiceAreaCity[];
  servedStates: string[];
  notes: string;
};

export type LeadLocationStatus = "inside" | "possible" | "outside" | "unknown";
export type LeadLocationConfidence = "high" | "medium" | "low" | "unknown";

type DddInfo = {
  state: string;
  region: string;
  city: string;
};

const DEFAULT_SERVICE_AREA: ServiceAreaSettings = {
  enabled: true,
  primaryCity: "",
  primaryState: "",
  servedCities: [],
  servedStates: [],
  notes: "",
};

const DDD_MAP: Record<string, DddInfo> = {
  "11": { state: "SP", region: "Grande Sao Paulo", city: "Sao Paulo" },
  "12": { state: "SP", region: "Vale do Paraiba e Litoral Norte", city: "Sao Jose dos Campos" },
  "13": { state: "SP", region: "Baixada Santista", city: "Santos" },
  "14": { state: "SP", region: "Centro-Oeste Paulista", city: "Bauru" },
  "15": { state: "SP", region: "Sorocaba e Itapetininga", city: "Sorocaba" },
  "16": { state: "SP", region: "Ribeirao Preto e Araraquara", city: "Ribeirao Preto" },
  "17": { state: "SP", region: "Sao Jose do Rio Preto", city: "Sao Jose do Rio Preto" },
  "18": { state: "SP", region: "Presidente Prudente e Aracatuba", city: "Presidente Prudente" },
  "19": { state: "SP", region: "Campinas e Piracicaba", city: "Campinas" },
  "21": { state: "RJ", region: "Rio de Janeiro e Regiao Metropolitana", city: "Rio de Janeiro" },
  "22": { state: "RJ", region: "Norte e Regiao dos Lagos", city: "Campos dos Goytacazes" },
  "24": { state: "RJ", region: "Sul Fluminense", city: "Volta Redonda" },
  "27": { state: "ES", region: "Grande Vitoria e Norte do ES", city: "Vitoria" },
  "28": { state: "ES", region: "Sul do Espirito Santo", city: "Cachoeiro de Itapemirim" },
  "31": { state: "MG", region: "Belo Horizonte e Regiao Metropolitana", city: "Belo Horizonte" },
  "32": { state: "MG", region: "Zona da Mata", city: "Juiz de Fora" },
  "33": { state: "MG", region: "Vale do Rio Doce", city: "Governador Valadares" },
  "34": { state: "MG", region: "Triangulo Mineiro", city: "Uberlandia" },
  "35": { state: "MG", region: "Sul de Minas", city: "Pocos de Caldas" },
  "37": { state: "MG", region: "Centro-Oeste de Minas", city: "Divinopolis" },
  "38": { state: "MG", region: "Norte de Minas", city: "Montes Claros" },
  "41": { state: "PR", region: "Curitiba e Regiao Metropolitana", city: "Curitiba" },
  "42": { state: "PR", region: "Centro-Sul do Parana", city: "Ponta Grossa" },
  "43": { state: "PR", region: "Norte do Parana", city: "Londrina" },
  "44": { state: "PR", region: "Noroeste do Parana", city: "Maringa" },
  "45": { state: "PR", region: "Oeste do Parana", city: "Foz do Iguacu" },
  "46": { state: "PR", region: "Sudoeste do Parana", city: "Pato Branco" },
  "47": { state: "SC", region: "Norte de Santa Catarina", city: "Joinville" },
  "48": { state: "SC", region: "Grande Florianopolis e Sul", city: "Florianopolis" },
  "49": { state: "SC", region: "Oeste de Santa Catarina", city: "Chapeco" },
  "51": { state: "RS", region: "Porto Alegre e Regiao Metropolitana", city: "Porto Alegre" },
  "53": { state: "RS", region: "Sul do Rio Grande do Sul", city: "Pelotas" },
  "54": { state: "RS", region: "Serra Gaucha", city: "Caxias do Sul" },
  "55": { state: "RS", region: "Centro-Oeste do Rio Grande do Sul", city: "Santa Maria" },
  "61": { state: "DF", region: "Distrito Federal e Entorno", city: "Brasilia" },
  "62": { state: "GO", region: "Goiania e Centro de Goias", city: "Goiania" },
  "63": { state: "TO", region: "Tocantins", city: "Palmas" },
  "64": { state: "GO", region: "Sul de Goias", city: "Rio Verde" },
  "65": { state: "MT", region: "Cuiaba e Centro-Sul do MT", city: "Cuiaba" },
  "66": { state: "MT", region: "Norte do Mato Grosso", city: "Sinop" },
  "67": { state: "MS", region: "Mato Grosso do Sul", city: "Campo Grande" },
  "68": { state: "AC", region: "Acre", city: "Rio Branco" },
  "69": { state: "RO", region: "Rondonia", city: "Porto Velho" },
  "71": { state: "BA", region: "Salvador e Regiao Metropolitana", city: "Salvador" },
  "73": { state: "BA", region: "Sul da Bahia", city: "Ilheus" },
  "74": { state: "BA", region: "Norte da Bahia", city: "Juazeiro" },
  "75": { state: "BA", region: "Feira de Santana e Reconcavo", city: "Feira de Santana" },
  "77": { state: "BA", region: "Oeste e Sudoeste da Bahia", city: "Vitoria da Conquista" },
  "79": { state: "SE", region: "Sergipe", city: "Aracaju" },
  "81": { state: "PE", region: "Recife e Regiao Metropolitana", city: "Recife" },
  "82": { state: "AL", region: "Alagoas", city: "Maceio" },
  "83": { state: "PB", region: "Paraiba", city: "Joao Pessoa" },
  "84": { state: "RN", region: "Rio Grande do Norte", city: "Natal" },
  "85": { state: "CE", region: "Fortaleza e Regiao Metropolitana", city: "Fortaleza" },
  "86": { state: "PI", region: "Norte do Piaui", city: "Teresina" },
  "87": { state: "PE", region: "Interior de Pernambuco", city: "Petrolina" },
  "88": { state: "CE", region: "Interior do Ceara", city: "Juazeiro do Norte" },
  "89": { state: "PI", region: "Sul do Piaui", city: "Picos" },
  "91": { state: "PA", region: "Belem e Nordeste do Para", city: "Belem" },
  "92": { state: "AM", region: "Manaus e Regiao Metropolitana", city: "Manaus" },
  "93": { state: "PA", region: "Oeste do Para", city: "Santarem" },
  "94": { state: "PA", region: "Sudeste do Para", city: "Maraba" },
  "95": { state: "RR", region: "Roraima", city: "Boa Vista" },
  "96": { state: "AP", region: "Amapa", city: "Macapa" },
  "97": { state: "AM", region: "Interior do Amazonas", city: "Tefe" },
  "98": { state: "MA", region: "Sao Luis e Norte do Maranhao", city: "Sao Luis" },
  "99": { state: "MA", region: "Sul do Maranhao", city: "Imperatriz" },
};

function onlyDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizeLocationText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeState(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().slice(0, 2);
}

export function parseServiceArea(value: unknown): ServiceAreaSettings {
  if (!value || typeof value !== "object") return DEFAULT_SERVICE_AREA;
  const data = value as Record<string, unknown>;
  const servedCities = Array.isArray(data.servedCities)
    ? data.servedCities
        .map((item): ServiceAreaCity | null => {
          if (!item || typeof item !== "object") return null;
          const city = typeof (item as Record<string, unknown>).city === "string" ? (item as { city: string }).city.trim() : "";
          const state = normalizeState((item as Record<string, unknown>).state as string | undefined);
          const priority = (item as Record<string, unknown>).priority;
          if (!city || !state) return null;
          return {
            city,
            state,
            priority: priority === "primary" || priority === "secondary" || priority === "occasional" ? priority : "secondary",
          };
        })
        .filter((item): item is ServiceAreaCity => item !== null)
    : [];

  const servedStates = Array.isArray(data.servedStates)
    ? data.servedStates.map((state) => normalizeState(String(state))).filter(Boolean)
    : [];

  return {
    enabled: data.enabled !== false,
    primaryCity: typeof data.primaryCity === "string" ? data.primaryCity.trim() : "",
    primaryState: normalizeState(data.primaryState as string | undefined),
    servedCities,
    servedStates: [...new Set(servedStates)],
    notes: typeof data.notes === "string" ? data.notes.trim() : "",
  };
}

export function getDddFromPhone(phone: string) {
  let digits = onlyDigits(phone);
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 10) return null;
  const ddd = digits.slice(0, 2);
  return DDD_MAP[ddd] ? ddd : null;
}

export function classifyServiceArea(info: DddInfo | null, settings: ServiceAreaSettings): LeadLocationStatus {
  if (!info) return "unknown";
  if (!settings.enabled) return "unknown";

  const state = normalizeState(info.state);
  const city = normalizeLocationText(info.city);
  const primaryState = normalizeState(settings.primaryState);
  const primaryCity = normalizeLocationText(settings.primaryCity);
  const servedCityMatch = settings.servedCities.some(
    (item) => normalizeState(item.state) === state && normalizeLocationText(item.city) === city
  );
  const servedStateMatch = settings.servedStates.map(normalizeState).includes(state);

  if ((primaryCity && primaryState && primaryCity === city && primaryState === state) || servedCityMatch) {
    return "inside";
  }

  if ((primaryState && primaryState === state) || servedStateMatch) {
    return "possible";
  }

  return "outside";
}

export function buildLocationPayload(phone: string, settingsValue: unknown, manualOverride = false) {
  if (manualOverride) return {};
  const phoneDdd = getDddFromPhone(phone);
  const info = phoneDdd ? DDD_MAP[phoneDdd] : null;
  const serviceArea = parseServiceArea(settingsValue);
  const status = classifyServiceArea(info, serviceArea);

  return {
    phone_country: phoneDdd ? "BR" : null,
    phone_ddd: phoneDdd,
    detected_state: info?.state ?? null,
    detected_region: info?.region ?? null,
    detected_city: info?.city ?? null,
    location_confidence: info ? ("medium" satisfies LeadLocationConfidence) : ("unknown" satisfies LeadLocationConfidence),
    service_area_status: status,
    location_updated_at: new Date().toISOString(),
  };
}

export async function getOrganizationServiceArea(admin: SupabaseAdmin, organizationId: string) {
  const { data } = await admin
    .from("organization_settings")
    .select("service_area")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.service_area ?? null;
}

export async function buildLocationPayloadForOrg(
  admin: SupabaseAdmin,
  organizationId: string,
  phone: string,
  manualOverride = false
) {
  const serviceArea = await getOrganizationServiceArea(admin, organizationId);
  return buildLocationPayload(phone, serviceArea, manualOverride);
}

export async function refreshLeadLocationsForOrg(
  admin: SupabaseAdmin,
  organizationId: string,
  serviceArea: ServiceAreaSettings
) {
  const { data: leads, error } = await fetchAllRows<{ id: string; phone: string | null }>(() =>
    admin
      .from("leads")
      .select("id, phone")
      .eq("organization_id", organizationId)
      .or("location_manually_edited.is.null,location_manually_edited.eq.false")
  );

  if (error || !leads?.length) return;

  for (let index = 0; index < leads.length; index += 100) {
    const chunk = leads.slice(index, index + 100);
    await Promise.all(
      chunk.map((lead) =>
        admin
          .from("leads")
          .update({
            ...buildLocationPayload(String(lead.phone ?? ""), serviceArea),
            location_manually_edited: false,
          })
          .eq("id", lead.id)
          .eq("organization_id", organizationId)
      )
    );
  }
}

export const LOCATION_STATUS_LABELS: Record<LeadLocationStatus, string> = {
  inside: "Dentro da area",
  possible: "Possivel area",
  outside: "Fora da area",
  unknown: "Indefinida",
};

export const LOCATION_CONFIDENCE_LABELS: Record<LeadLocationConfidence, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baixa",
  unknown: "Indefinida",
};
