/**
 * Stand-in vocabulary for the decoder stub, most frequent first.
 *
 * Hand-assembled for the prototypes: English function words and common verbs in roughly their
 * spoken-English frequency order, followed by AAC core vocabulary (needs, feelings, people,
 * places, time) and everyday conversation words. It is not a corpus-derived list and carries no
 * frequency counts. The real language model replaces it.
 */
const TEXT = `
the i you to and a it is that of in my me we he she they was be have not do on with for this but
at are so what can if there just know like get all no yes go about would up one out them will time
think when some how your good want see here now then more than our had has were been his her him
his its who which them these those us an as by from or into over too very well okay ok right
really say said tell told going come came back down off much many also could should might must
need needs let make made give gave take took put got look looking thing things way day today
tomorrow yesterday morning afternoon evening night week year people person friend family mom dad
mother father sister brother son daughter husband wife partner baby kid kids child children doctor
nurse carer caregiver help please thanks thank sorry hello hi hey bye goodbye love hate feel feeling
fine great happy sad tired sleepy awake hungry thirsty cold hot warm sick pain hurt hurts ache better
worse okay alright bad terrible wonderful nice lovely beautiful ugly big small little long short
new old young first last next again never always sometimes often maybe probably sure course
because why where who whom whose something nothing anything everything someone anyone everyone
somewhere anywhere everywhere here there home house room bed bathroom toilet kitchen door window
chair wheelchair car bus outside inside garden park shop store hospital clinic school work office
water drink eat food lunch dinner breakfast coffee tea juice milk bread soup cake fruit apple
banana orange sandwich pizza chicken rice salad snack medicine pill pills tablet dose glasses phone
tablet computer screen tv television music song movie book read reading write writing play game
watch listen talk talking speak speaking call text message email news weather rain sunny sun
cloudy wind snow heat cool light dark loud quiet slow fast soon late early later before after
until while during around near far left right straight ahead behind front top bottom middle
open close turn start stop wait keep hold move stay sit stand lie down walk run drive ride bring
carry push pull lift drop pick choose find lose win show hide try use work rest sleep wake dream
remember forget understand mean means meant hope wish believe guess agree disagree decide prefer
enjoy mind care matter worry relax breathe hurt itch scratch cough sneeze yawn blink smile laugh
cry shout whisper ask answer question reply explain describe repeat spell change fix break clean
wash shower bath brush teeth hair face hands hand arm arms leg legs foot feet head neck back
shoulder chest stomach eye eyes ear ears nose mouth lip tongue throat heart body skin bone
muscle tired exhausted weak strong dizzy nauseous numb stiff sore itchy warm freezing sweaty
comfortable uncomfortable position pillow blanket sheet adjust higher lower louder softer
bigger smaller brighter dimmer on off up down in out more less enough too half full empty
some any every each both either neither other another same different only own such own
through across along past toward against between among above below under beside
monday tuesday wednesday thursday friday saturday sunday january february march april may june
july august september october november december hour minute second o'clock noon midnight
zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty
hundred thousand number count name age birthday party gift present visit visitor guest meeting
appointment date plan schedule busy free ready done finished almost nearly already still yet
ever once twice usually rarely instead otherwise anyway however although though whether
money pay buy sell cost price cheap expensive bill card cash bank
dog cat bird fish pet animal tree flower grass sky star moon sea beach mountain river road street
city town country world
red blue green yellow black white grey gray brown pink purple orange
yes no not never maybe ok okay sure fine absolutely exactly definitely totally kind sort bit lot
something else anything else nothing else somebody nobody everybody
can't don't won't isn't aren't wasn't weren't doesn't didn't haven't hasn't hadn't couldn't
shouldn't wouldn't i'm i've i'll i'd you're you've you'll you'd he's she's it's we're we've
we'll they're they've they'll that's there's here's what's who's where's let's
able about above accept across act add afraid afternoon ago agree air allow alone along already
although amount angry annoyed anxious apart appear area arrive art attention aunt uncle cousin
grandma grandpa grandmother grandfather neighbour neighbor boss colleague teacher student
available average avoid away awful bag ball bath battery because become begin behind believe
belong best bite blood board boring born borrow bother bottle box bright broken bruise burn busy
button cable calm camera cancel careful case catch cause certain chance charge charger cheap
check cheese chocolate choice church clear clock clothes coat shoes socks shirt trousers pants
dress jacket hat scarf gloves comfortable company complete concern confused control cook cool
copy corner correct couch sofa cough course cover crazy cup curtain cushion cut dangerous dark
deal dear decide deep deliver dentist depend difficult dirty disappointed discuss dish doctor
double doubt draw dress drop dry due during easy edge effort elbow else email emergency end
energy enjoy especially even event exactly example excited excuse exercise expect explain extra
fact fair fall false fan favourite favorite fear feed fever few fight fill film final finger
finish fire fit flat floor fly focus follow football form forward frame fresh fridge front
frustrated fun funny future garage gas gentle glad glass gone grab grateful groceries ground
group grow guess guest guide gym hall handle hang happen hard harm headache health hear heavy
height hip history hobby holiday honest horrible hospital hug huge hurry ice idea ill
important impossible improve include information injection interesting internet invite iron
job join joke jump just kettle key kick kind kiss knee knife knock lamp land language large
laundry lawyer lazy lead learn leave lend letter level library lie life lift limit line lip
list live lock lonely look loose lost loud lucky lunch machine mail main manage map mark match
meal measure meat medical meet memory mention menu mess mirror miss mistake mix moment month
mood motor mouth nap nasty nature necessary needle nervous nephew niece noise normal note
notice number obvious occasion offer often oil opinion order ordinary pack page painful paint
pair paper parent part pass patient pattern peace pen pencil perfect period permission
physio physiotherapist piece place plate pleased plenty pocket point police polite poor
possible post pot pour powder power practice pray prepare pressure pretty print private
problem program promise proper proud pub public pump purse quick quite radio raise rather
reach reason receive recent record recover regular relative relief remind remote repair
report respect responsible result return ride ring rise risk roll roof rope rough round rubbish
rude rule rush safe salt sauce save scared scissors season seat secret see seem send sense
serious serve service set settle shake shame share sharp shave sheet shelf shine ship shock
shoe shop shoulder sign silly simple since single sink situation size skill slip slippers
smell smoke smooth snack soap soft solid solve sore sort sound soup space spare special speed
spend spill spoon sport spot spread spring square squeeze stairs stamp state station steady
steal steam step stick stomach stone story straight strange stress stretch strict strong
stuck study stuff subject sudden sugar suit summer support suppose surprise swallow sweet
swim switch symptom table taste tax taxi team tear temperature tent test thick thin throw
ticket tie tight tiny tip tissue title toe tomato tool tooth top total touch towel town toy
track traffic train travel treat trip trouble truck true trust truth tube tune type
umbrella uncomfortable upset upstairs downstairs useful usual vacation van vegetable video
view village visit voice volume vote wall wallet warn waste wave weak wear wedding weigh weight
welcome wet wheel wide wild wine winter wipe wire wise wonder wood wool word worth wrap wrist
wrong yard yell yoga zip
`;

const seen = new Set<string>();
export const VOCABULARY: readonly string[] = TEXT.split(/\s+/).filter((word) => {
  if (!word || seen.has(word)) return false;
  seen.add(word);
  return true;
});
