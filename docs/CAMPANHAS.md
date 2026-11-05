# Operação de campanhas

## Publicar ofertas nas TVs

1. Abra **Campanhas → Filiais** e cadastre as lojas. Associe as TVs a uma filial e um setor. As TVs são cadastradas e vinculadas em **Pontos**.
2. Importe o catálogo em **Produtos e cargas**. Para usar logo ou fundo, envie as imagens em **Conteúdos** e salve um kit em **Campanhas → Identidade visual**.
3. Na aba **Campanhas**, escolha nome, início, fim, tipo de preço e layout. Pesquise os produtos e monte até seis por setor. Escolha o kit de cada cartaz e marque as TVs de destino.
4. Use **Conferir impacto** para ver as TVs, o período, os produtos e a variação de preço. A referência é a campanha mais recente prevista para aquela TV no início da nova veiculação, considerando ajustes da filial. Quando não há campanha para o produto, a referência é o preço normal do catálogo. Produtos indisponíveis impedem a publicação.
5. Use **Confirmar publicação**. A campanha entra na sequência com a playlist normal. Cada uma conserva seu horário. A campanha também pode ser exibida em uma TV que ainda não tem playlist.

O **Limite de variação de preço** é opcional. Variações para cima ou para baixo acima do limite exigem confirmação explícita na prévia ao publicar uma campanha nova. Alterações nos dados conferidos exigem uma nova prévia.

Os horários do formulário usam o fuso do computador que fez a publicação. O player aplica a validade localmente e pode exibir campanhas que já baixou durante uma queda de conexão. A proteção de preços continua valendo por 24 horas desde a última confirmação. Cancelamento, remanejamento de TV e ajustes feitos no servidor chegam quando o aparelho volta a sincronizar. Uma TV desconectada pode continuar com a versão baixada até o fim da validade ou até atingir o limite de preços offline.

## Permissões da filial

Em **Filiais**, gere uma chave de consulta ou de edição e entregue-a junto com o endereço `/filial` por um canal seguro. Use HTTPS quando o painel e o portal forem acessados pela rede. Uma chave dá acesso às campanhas das TVs daquela filial. Com permissão de edição, a filial pode reduzir o período ao intervalo autorizado pela matriz e trocar os preços dos produtos destinados a ela. Deixe o preço em branco para usar o preço da matriz. Uma nova chave ou a revogação invalida a anterior.

## Receber cargas do ERP

Em **Campanhas → ERP**, ative a integração e copie a chave exibida. O sistema de origem deve enviar uma carga completa por solicitação. Produtos ausentes da carga aplicada ficam indisponíveis no catálogo.

```http
POST /api/erp/imports
Authorization: Bearer CHAVE_DO_ERP
Content-Type: application/json

{"filename":"produtos.csv","text":"codigo;departamento;nome;preco_normal;preco_oferta;unidade\n1;01;Manga;10.00;8.50;kg"}
```

- **Revisão** deixa a carga em **Produtos e cargas**, com diferenças de preço e disponibilidade. Depois de aprovar e aplicar o catálogo, use **Atualizar preços pelo catálogo** em **Campanhas** para atualizar as ofertas da matriz.
- **Automático** aplica a carga e atualiza as campanhas vigentes ou futuras. Preços definidos na filial continuam valendo enquanto o produto estiver disponível no catálogo. As peças avulsas de playlists usam o fluxo de atualização e publicação em **Produtos e cargas**.

A entrada aceita CSV no formato do catálogo e arquivos ITENSMGV decodificados como texto. Um ERP específico precisa configurar esse envio ou usar um adaptador para produzir a solicitação. Faça a primeira carga no modo de revisão para conferir o mapeamento de produtos e os preços.

## Alertas, relatórios e MP4

- **Alertas** registra perda de conexão, programação pendente e falhas repetidas. A barra superior indica incidentes abertos que ainda precisam ser reconhecidos. Cada incidente permanece no histórico depois da recuperação.
- **Ver relatório** mostra inícios, conclusões e falhas por filial e TV. TVs sem eventos aparecem com contagem zero. Os eventos recuperados do player offline entram com o horário original. Os eventos seguem a política de retenção do VideoWall.
- **Exportar MP4** cria uma sequência animada dos produtos da matriz em H.264, com transições, logo e fundo do kit. Selecione horizontal ou vertical e mantenha a aba visível enquanto o navegador grava. É necessário suporte à gravação MP4 no navegador. A reprodução por USB depende dos formatos aceitos pela TV.

A versão publicada para as TVs fica em snapshots próprios. As campanhas e os kits ficam no mesmo banco SQLite do aplicativo. Inclua o diretório de dados nos backups habituais.

## Verificação local

Execute `npm test` para a suíte de integração. Para verificar a interface, a reprodução com cache e o MP4 em um perfil isolado, execute `node scripts/verify-campaign-browser.mjs "caminho-do-chrome"`.
