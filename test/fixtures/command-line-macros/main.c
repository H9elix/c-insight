#define SOURCE_TRACE trace_value

int second_file_value(void);

int trace_value(int value)
{
    return value + 1;
}

int feature_value(void)
{
#if CI_BUILD_FEATURE
    return CI_BUILD_NUMBER;
#else
    return -1;
#endif
}

int main(void)
{
    int compiler_alias = CI_BUILD_TRACE(CI_BUILD_NUMBER);
    int source_alias = SOURCE_TRACE(CI_BUILD_NUMBER);
    int direct = trace_value(CI_BUILD_NUMBER);

    return feature_value() == 7 && second_file_value() == 7 &&
           compiler_alias == 8 && source_alias == 8 && direct == 8 ? 0 : 1;
}
