# Análise do monitoramento Musardos

Inspeção em 03/11/2026, pela aba autenticada em https://videowall.musardos.com/#/monitoramento, versão web v3.9.8. Comparação com o código local atual. Foram abertos filtros, detalhes do ponto e log de exibição. Nenhum comando de atualização de TV foi executado, nenhuma playlist foi alterada e nenhuma publicação foi realizada.

## O que foi observado

| Recurso da referência | Situação no projeto local | Adaptação proposta |
|---|---|---|
| Saúde da rede com percentuais online/offline, totais clicáveis e atalhos de problema | Percentual online, totais e filtros de estado já existem | Tornar os indicadores atalhos de filtro e reunir contadores de problemas abaixo da barra |
| Busca por nome, visualização em cartões e lista | Busca na página Pontos; dashboard em cartões | Compartilhar busca e filtros entre Monitoramento e Pontos; acrescentar modo lista |
| Filtros de múltipla escolha | Um filtro de estado por vez | Seleção múltipla, contador e botão limpar; documentar união entre estados selecionados |
| Offline há mais de 5/30 dias; vinculado/não vinculado | Último sinal e vínculo já disponíveis | Derivar os intervalos pelo relógio do servidor; pontos nunca vistos devem ter estado próprio |
| Filtros sem Wi-Fi configurado, ativo/inativo e demonstração | Sem campos equivalentes confirmados | Só oferecer depois de implementar e receber esses dados; não inferir Wi-Fi de ausência de sinal |
| Ocultar saúde da rede e resumo de uso | Blocos fixos | Preferência local de apresentação, sem alterar filtros nem dados da operação |
| Indicadores de uso nos últimos 30 dias e atividade diária | Gráfico de inícios das últimas 12 horas; relatório de eventos em 30 dias | Resumo diário de uploads, publicações e cargas confirmadas, com período explícito |
| Tempo no ar e horas por dia | Eventos de início/término e último sinal, sem histórico contínuo de presença | Registrar sessões e amostras de reprodução antes de calcular horas e disponibilidade |
| Economia de deslocamento e papel | Sem cálculo equivalente | Segunda etapa: estimativa opcional com custos configuráveis e fórmula visível |
| Miniatura do conteúdo exibido e identificação/versão do player | Prévia do conteúdo e versão publicada/em uso já existem | Acrescentar legenda que distingue prévia cadastrada de captura recebida da TV |
| Aviso de preços sem atualização há três dias | Bloqueio de preços após 24 horas sem confirmação da programação no player | Exibir separadamente idade da carga de preços, publicação e última confirmação do player |
| Detalhes: modelo, fabricante, Android, memória, uptime, último print, sinal, carga e TXT | Sinal, conteúdo, versão em uso e progresso de cache offline disponíveis | Ampliar protocolo de telemetria, marcando campos não suportados como indisponíveis |
| Atualizar TV individual e todos os pontos | Comando individual existente | Ação coletiva com quantidade/alvos explícitos e resultado por ponto; não publicar rascunhos |
| Log dos últimos 30 minutos com ordem da playlist, tipo e duração, atualização a cada 30 segundos e divisor redimensionável | Modal de playlist publicada e eventos de 30 minutos; atualização a cada 5 segundos | Acrescentar tipo/duração conhecida, prévia clicável, painel redimensionável e preferência do intervalo |

## Distinções importantes para a implementação

- **Online** representa comunicação recente; **reproduzindo** depende do estado reportado pelo player. Um ponto pode estar online sem exibir conteúdo. O projeto já trata esses estados separadamente.
- **Prévia** é o conteúdo cadastrado/renderizado; **captura remota** exige imagem realmente enviada pelo aparelho e horário da captura. O player web atual não comprova a imagem física da TV. Captura do sistema Android precisará de suporte específico do aplicativo/dispositivo.
- **Última carga de preços** é a aplicação confirmada da fonte de preços. Atualizar a página, reconectar o player ou confirmar uma programação não comprova atualização do arquivo de origem. As cargas pendentes de revisão não devem renovar esse indicador.
- **Tempo no ar** não pode ser calculado multiplicando a quantidade de eventos pela duração configurada: vídeos, interrupções, agendamentos, erros e registros offline precisam ser considerados. Usar intervalos comprovados, identificadores idempotentes e limites para lacunas de telemetria.
- A referência mostrou uptime de **112,292%** no detalhe. A fórmula não foi verificada; não reproduzir esse valor ou assumir que é disponibilidade válida. Percentuais de disponibilidade locais devem ficar entre 0 e 100, com janela e definição explícitas.
- O modal informa últimos 30 minutos, mas na amostra os eventos exibiam horários anteriores à janela aparente do painel. Sem verificar relógios/fusos da origem, a causa permanece incerta. A implementação local deve usar timestamps UTC e exibir America/Sao_Paulo de maneira consistente.
- Custos/economias da referência são valores da conta observada, não parâmetros do nosso projeto. Não copiar números como métricas reais.

## Sequência recomendada

1. **Operação diária:** indicadores clicáveis, busca no monitoramento, filtros múltiplos e offline por tempo, modo lista/cartões e preferência para recolher blocos. Usar os dados já disponíveis.
2. **Qualidade dos preços:** cartão com última carga confirmada, origem e idade; distinguir carga pendente, programação publicada e confirmação do player; alerta de atraso sem afrouxar a regra offline de 24 horas.
3. **Histórico de uso:** registrar uploads, publicações e cargas aplicadas; consolidar dias no fuso do estabelecimento; exibir 30 dias com drill-down. Só calcular horas após persistir intervalos de reprodução.
4. **Diagnóstico do aparelho:** versão do player, plataforma e capacidades; memória/uptime/captura apenas quando medidos e suportados; timestamps e estado desconhecido explícitos.
5. **Ações coletivas e estimativas:** atualização de pontos com retorno por aparelho; economia opcional e identificada como estimativa.

## Pontos de alteração no código

- `public/app.js`: dashboard, cartões, tabela de pontos, busca e integração com filtros.
- `public/monitor-utils.js`: regras de filtros e estados; manter online, reprodução, agenda e vínculo independentes.
- `public/monitor-ui.js`: detalhes, playlist, eventos, tipo/duração e apresentação das capacidades.
- `src/app.mjs`: DTO de ponto, agregados do dashboard, comandos e ingestão de telemetria.
- `src/database.mjs`: histórico aditivo de atividade e presença, sem alterar snapshots publicados.
- `src/catalog.mjs`: origem/horário da última carga efetivamente aplicada.
- `public/player.js` e módulos offline: telemetria e reenvio idempotente; preservar publicação anterior, cache e limite de preços.

## Critérios de aceite da primeira etapa

- Sem pontos, nunca conectado, offline por 5/30 dias e estado desconhecido têm representação correta.
- Busca e filtros combinam sem perder seleção durante a atualização automática.
- Os totais mostram se correspondem à rede inteira ou ao conjunto filtrado.
- Falha de API conserva a última informação com horário e aviso de desatualização.
- Modo lista e cartões preservam as mesmas ações e informações essenciais, inclusive em tela estreita.
- Nenhuma ação de visualização publica rascunho ou envia comando à TV.

Evidências: `verification/screenshots/musardos-monitoramento-visao-geral.png`, `musardos-monitoramento-ponto.png` e `musardos-monitoramento-log.png`.

Esta entrega documenta a análise e o escopo de adaptação. As novas funções de monitoramento ainda não foram implementadas.
