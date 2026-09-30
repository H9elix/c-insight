static volatile int report_sink;

static void report(const char *name, int value)
{
    report_sink += name[0] + value;
}

static int add(int left, int right)
{
    report("left", left);
    report("right", right);
    return left + right;
}

typedef struct MemberLeaf {
    int rate;
} MemberLeaf;

typedef struct MemberFixture {
    int value;
    MemberLeaf *leaf;
} MemberFixture;

static MemberLeaf member_fallback_leaf;
static MemberFixture member_fallback = { 0, &member_fallback_leaf };

static MemberFixture *member_factory(void)
{
    return &member_fallback;
}

static int member_total(MemberFixture *selected, MemberFixture *other)
{
    int result = selected->value;
    result += selected->value;
    result += other->value;
    result += member_factory()->value;
    result += selected->leaf->rate;
    result += selected->leaf->rate;
    result += other->leaf->rate;
    result += member_factory()->leaf->rate;
    return result;
}

int main(void)
{
    MemberLeaf selected_leaf = { 3 };
    MemberLeaf other_leaf = { 4 };
    MemberFixture selected = { 1, &selected_leaf };
    MemberFixture other = { 2, &other_leaf };
    int value = add(1, 2);
    report("first", value);
    report("second", value + 1);
    report("third", value + 2);
    return report_sink + member_total(&selected, &other);
}
